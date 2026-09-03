-- Hosted Auth is configured with an eight-digit OTP in this project.
-- The custom mail bridge replaces only the pending token hash with a six-digit OTP.
create or replace function public.override_auth_otp(p_email text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_updated integer;
begin
  if p_code !~ '^\d{6}$' then
    return false;
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    return false;
  end if;

  update auth.one_time_tokens
  set token_hash = encode(extensions.digest(lower(trim(p_email)) || p_code, 'sha224'), 'hex'),
      updated_at = now()
  where user_id = v_user_id
    and token_type in ('confirmation_token', 'recovery_token');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.override_auth_otp(text, text) from public, anon, authenticated;
grant execute on function public.override_auth_otp(text, text) to service_role;
