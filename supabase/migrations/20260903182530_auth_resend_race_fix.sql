-- Keep every recently delivered code valid until its own expiry. Email
-- providers may delay or reorder messages, so a resend must not revoke a
-- code the customer has not used yet.
create index if not exists auth_email_codes_lookup_idx
  on private.auth_email_codes (email_hash, code_hash, created_at desc)
  where used_at is null;

create or replace function public.store_auth_email_code(
  p_email text,
  p_code text,
  p_token_hash text,
  p_verification_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_email_hash text := encode(extensions.digest(v_email, 'sha256'), 'hex');
begin
  if p_code !~ '^\d{6}$'
    or length(coalesce(p_token_hash, '')) < 16
    or p_verification_type not in ('signup', 'invite', 'magiclink', 'recovery', 'email') then
    return false;
  end if;

  delete from private.auth_email_codes
  where created_at < now() - interval '24 hours';

  insert into private.auth_email_codes (
    email_hash,
    code_hash,
    token_hash,
    verification_type
  ) values (
    v_email_hash,
    encode(extensions.digest(v_email || ':' || p_code, 'sha256'), 'hex'),
    p_token_hash,
    p_verification_type
  );

  return true;
end;
$$;

revoke all on function public.store_auth_email_code(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.store_auth_email_code(text, text, text, text)
  to service_role;

create or replace function public.consume_auth_email_code(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_email_hash text := encode(extensions.digest(v_email, 'sha256'), 'hex');
  v_code_hash text := encode(extensions.digest(v_email || ':' || p_code, 'sha256'), 'hex');
  v_code private.auth_email_codes%rowtype;
begin
  if p_code !~ '^\d{6}$' then
    return null;
  end if;

  select * into v_code
  from private.auth_email_codes
  where email_hash = v_email_hash
    and code_hash = v_code_hash
    and used_at is null
    and expires_at > now()
    and attempts < 5
  order by created_at desc
  limit 1
  for update;

  if found then
    update private.auth_email_codes
    set attempts = (attempts + 1)::smallint,
        used_at = now()
    where id = v_code.id;

    return jsonb_build_object(
      'verification_type', v_code.verification_type
    );
  end if;

  -- Apply the same attempt budget to all still-valid codes for this address,
  -- preventing a resend from multiplying brute-force opportunities.
  update private.auth_email_codes
  set attempts = least(5, attempts::integer + 1)::smallint
  where email_hash = v_email_hash
    and used_at is null
    and expires_at > now()
    and attempts < 5;

  return null;
end;
$$;

revoke all on function public.consume_auth_email_code(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_auth_email_code(text, text)
  to service_role;

comment on function public.consume_auth_email_code(text, text) is
  'Consumes the exact matching six-digit code, including a still-valid code issued before a resend.';
