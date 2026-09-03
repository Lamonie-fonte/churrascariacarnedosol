-- Conta do cliente, agenda de endereços, histórico e controles administrativos.
alter table public.profiles add column if not exists is_blocked boolean not null default false;
alter table public.profiles add column if not exists blocked_at timestamptz;
alter table public.profiles add column if not exists blocked_reason text;

alter table public.store_settings add column if not exists delivery_eta_minutes integer not null default 60;
alter table public.store_settings drop constraint if exists store_settings_delivery_eta_minutes_check;
alter table public.store_settings add constraint store_settings_delivery_eta_minutes_check check (delivery_eta_minutes between 10 and 240);

alter table public.orders add column if not exists client_request_id uuid;
alter table public.orders add column if not exists delivery_eta_minutes integer not null default 60;
alter table public.orders drop constraint if exists orders_delivery_eta_minutes_check;
alter table public.orders add constraint orders_delivery_eta_minutes_check check (delivery_eta_minutes between 10 and 240);
alter table public.order_items add column if not exists notes text;

create unique index if not exists orders_customer_request_unique
  on public.orders(customer_id,client_request_id)
  where customer_id is not null and client_request_id is not null;

create table if not exists public.saved_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Casa',
  postal_code text not null check (length(trim(postal_code)) between 8 and 9),
  street text not null check (length(trim(street)) > 1),
  number text not null check (length(trim(number)) > 0),
  complement text,
  neighborhood text not null check (length(trim(neighborhood)) > 1),
  city text not null check (length(trim(city)) > 1),
  state text not null check (length(trim(state)) = 2),
  reference text,
  is_default boolean not null default false,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_addresses_user_recent_idx on public.saved_addresses(user_id,is_default desc,last_used_at desc);
alter table public.saved_addresses enable row level security;

drop trigger if exists saved_addresses_updated_at on public.saved_addresses;
create trigger saved_addresses_updated_at before update on public.saved_addresses
for each row execute function public.set_updated_at();

create or replace function private.keep_one_default_address()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.is_default then
    update public.saved_addresses set is_default=false
     where user_id=new.user_id and id<>new.id and is_default;
  end if;
  return null;
end; $$;
revoke execute on function private.keep_one_default_address() from public,anon,authenticated,service_role;
drop trigger if exists saved_addresses_one_default on public.saved_addresses;
create trigger saved_addresses_one_default after insert or update of is_default on public.saved_addresses
for each row execute function private.keep_one_default_address();

drop policy if exists "saved addresses own read" on public.saved_addresses;
drop policy if exists "saved addresses own insert" on public.saved_addresses;
drop policy if exists "saved addresses own update" on public.saved_addresses;
drop policy if exists "saved addresses own delete" on public.saved_addresses;
create policy "saved addresses own read" on public.saved_addresses for select
  using (user_id=(select auth.uid()) or (select private.is_admin()));
create policy "saved addresses own insert" on public.saved_addresses for insert
  with check (user_id=(select auth.uid()));
create policy "saved addresses own update" on public.saved_addresses for update
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy "saved addresses own delete" on public.saved_addresses for delete
  using (user_id=(select auth.uid()) or (select private.is_admin()));

drop policy if exists "admin orders delete" on public.orders;
create policy "admin orders delete" on public.orders for delete using ((select private.is_admin()));

revoke execute on function public.create_order(jsonb) from anon;
grant execute on function public.create_order(jsonb) to authenticated;
grant select,insert,update,delete on public.saved_addresses to authenticated;

