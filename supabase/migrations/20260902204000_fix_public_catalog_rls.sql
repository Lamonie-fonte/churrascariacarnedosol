-- Separate public visibility from administrative visibility.
-- This prevents anonymous reads from evaluating the admin helper function.
grant execute on function private.is_admin() to authenticated;

drop policy if exists "public read active categories" on public.categories;
drop policy if exists "public read active products" on public.products;
drop policy if exists "public read option groups" on public.option_groups;
drop policy if exists "public read active options" on public.product_options;

create policy "public read active categories"
on public.categories for select to anon, authenticated
using (active);

create policy "admins read all categories"
on public.categories for select to authenticated
using ((select private.is_admin()));

create policy "public read active products"
on public.products for select to anon, authenticated
using (active);

create policy "admins read all products"
on public.products for select to authenticated
using ((select private.is_admin()));

create policy "public read option groups"
on public.option_groups for select to anon, authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_id and p.active
));

create policy "admins read all option groups"
on public.option_groups for select to authenticated
using ((select private.is_admin()));

create policy "public read active options"
on public.product_options for select to anon, authenticated
using (active);

create policy "admins read all options"
on public.product_options for select to authenticated
using ((select private.is_admin()));

drop policy if exists "profile self read" on public.profiles;
create policy "profile self read"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "orders own read" on public.orders;
create policy "orders own read"
on public.orders for select to authenticated
using (customer_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "order items own read" on public.order_items;
create policy "order items own read"
on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = order_id
    and (o.customer_id = (select auth.uid()) or (select private.is_admin()))
));
