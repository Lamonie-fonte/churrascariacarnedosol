-- Keep the customer-facing code at exactly six digits without modifying
-- Supabase Auth's internal tables. The official token hash remains private
-- and is exchanged only after the branded code has been validated.
create table if not exists private.auth_email_codes (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  code_hash text not null,
  token_hash text not null,
  verification_type text not null
    check (verification_type in ('signup', 'invite', 'magiclink', 'recovery', 'email')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_email_codes_email_created_idx
  on private.auth_email_codes (email_hash, created_at desc);

revoke all on private.auth_email_codes from public, anon, authenticated;

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

  update private.auth_email_codes
  set used_at = coalesce(used_at, now())
  where email_hash = v_email_hash and used_at is null;

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
    and used_at is null
    and expires_at > now()
    and attempts < 5
  order by created_at desc
  limit 1
  for update;

  if not found then
    return null;
  end if;

  update private.auth_email_codes
  set attempts = attempts + 1
  where id = v_code.id;

  if v_code.code_hash <> v_code_hash then
    return null;
  end if;

  update private.auth_email_codes
  set used_at = now()
  where id = v_code.id;

  return jsonb_build_object(
    'token_hash', v_code.token_hash,
    'verification_type', v_code.verification_type
  );
end;
$$;

revoke all on function public.consume_auth_email_code(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_auth_email_code(text, text)
  to service_role;

comment on table private.auth_email_codes is
  'Server-only bridge between branded six-digit codes and official Supabase Auth tokens.';
