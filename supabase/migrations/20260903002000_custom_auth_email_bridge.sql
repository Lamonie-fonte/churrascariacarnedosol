-- Server-only bridge used by the public pre-auth Edge Function.
-- SMTP credentials remain encrypted in Vault and are never returned to clients.
create extension if not exists pgcrypto with schema extensions;

create table if not exists private.auth_email_dispatches (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  sent_at timestamptz not null default now()
);

create index if not exists auth_email_dispatches_email_time_idx
  on private.auth_email_dispatches (email_hash, sent_at desc);

revoke all on private.auth_email_dispatches from public, anon, authenticated;

create or replace function public.get_auth_mail_config()
returns table (smtp_user text, smtp_password text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'carne_sol_smtp_user'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'carne_sol_gmail_app_password');
$$;

revoke all on function public.get_auth_mail_config() from public, anon, authenticated;
grant execute on function public.get_auth_mail_config() to service_role;

create or replace function public.reserve_auth_email_dispatch(p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(extensions.digest(lower(trim(p_email)), 'sha256'), 'hex');
begin
  delete from private.auth_email_dispatches where sent_at < now() - interval '24 hours';

  if exists (
    select 1 from private.auth_email_dispatches
    where email_hash = v_hash and sent_at > now() - interval '60 seconds'
  ) then
    return false;
  end if;

  if (select count(*) from private.auth_email_dispatches where email_hash = v_hash and sent_at > now() - interval '1 hour') >= 5 then
    return false;
  end if;

  if (select count(*) from private.auth_email_dispatches where sent_at > now() - interval '1 hour') >= 250 then
    return false;
  end if;

  insert into private.auth_email_dispatches(email_hash) values (v_hash);
  return true;
end;
$$;

revoke all on function public.reserve_auth_email_dispatch(text) from public, anon, authenticated;
grant execute on function public.reserve_auth_email_dispatch(text) to service_role;
