-- Sends every newly created order to the Gmail relay without exposing secrets
-- to the browser or to the public repository.
create extension if not exists pg_net with schema extensions;

create table if not exists private.order_email_dispatches (
  order_id uuid primary key references public.orders(id) on delete cascade,
  request_id bigint,
  attempt_count integer not null default 1,
  queued_at timestamptz not null default now(),
  last_error text
);

revoke all on private.order_email_dispatches from public, anon, authenticated;

create or replace function private.dispatch_order_email(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return null;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'carne_sol_google_script_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'carne_sol_webhook_secret';

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    insert into private.order_email_dispatches(order_id, last_error)
    values (p_order_id, 'Configuração de e-mail ausente')
    on conflict (order_id) do update
      set attempt_count = private.order_email_dispatches.attempt_count + 1,
          queued_at = now(),
          last_error = excluded.last_error;
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'secret', v_secret,
      'event', 'order_created',
      'payload', jsonb_build_object(
        'order_number', v_order.order_number,
        'customer_name', v_order.customer_name,
        'email', v_order.email,
        'phone', v_order.phone,
        'order_type', v_order.order_type,
        'payment_method', v_order.payment_method,
        'total', v_order.total,
        'created_at', v_order.created_at
      )
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;

  insert into private.order_email_dispatches(order_id, request_id, last_error)
  values (p_order_id, v_request_id, null)
  on conflict (order_id) do update
    set request_id = excluded.request_id,
        attempt_count = private.order_email_dispatches.attempt_count + 1,
        queued_at = now(),
        last_error = null;

  return v_request_id;
exception when others then
  insert into private.order_email_dispatches(order_id, last_error)
  values (p_order_id, left(sqlerrm, 500))
  on conflict (order_id) do update
    set attempt_count = private.order_email_dispatches.attempt_count + 1,
        queued_at = now(),
        last_error = excluded.last_error;
  return null;
end;
$$;

revoke all on function private.dispatch_order_email(uuid) from public, anon, authenticated, service_role;

create or replace function private.notify_order_email_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_order_email(new.id);
  return new;
end;
$$;

revoke all on function private.notify_order_email_trigger() from public, anon, authenticated, service_role;

drop trigger if exists order_email_after_insert on public.orders;
create trigger order_email_after_insert
after insert on public.orders
for each row execute function private.notify_order_email_trigger();
