-- Mantém a RPC pública como invoker e isola a função privilegiada em schema não exposto.
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;

alter function public.create_order(jsonb) set schema private;
alter function private.create_order(jsonb) rename to create_order_impl;
revoke all on function private.create_order_impl(jsonb) from public;
grant execute on function private.create_order_impl(jsonb) to anon, authenticated;

create or replace function public.create_order(payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_order_impl(payload);
$$;
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;

drop policy if exists "admin store write" on public.store_settings;
drop policy if exists "admin categories write" on public.categories;
drop policy if exists "admin products write" on public.products;
drop policy if exists "admin groups write" on public.option_groups;
drop policy if exists "admin options write" on public.product_options;

create policy "admin store update" on public.store_settings for update using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin categories insert" on public.categories for insert with check ((select private.is_admin()));
create policy "admin categories update" on public.categories for update using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin categories delete" on public.categories for delete using ((select private.is_admin()));
create policy "admin products insert" on public.products for insert with check ((select private.is_admin()));
create policy "admin products update" on public.products for update using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin products delete" on public.products for delete using ((select private.is_admin()));
create policy "admin groups insert" on public.option_groups for insert with check ((select private.is_admin()));
create policy "admin groups update" on public.option_groups for update using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin groups delete" on public.option_groups for delete using ((select private.is_admin()));
create policy "admin options insert" on public.product_options for insert with check ((select private.is_admin()));
create policy "admin options update" on public.product_options for update using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin options delete" on public.product_options for delete using ((select private.is_admin()));

-- Restaura a 304ª opção técnica do site de origem para preservar a importação sem exceção.
do $$
declare product_uuid uuid; group_uuid uuid;
begin
  select id into product_uuid from public.products where source_id='75';
  if product_uuid is not null and not exists(select 1 from public.option_groups where product_id=product_uuid and source_group_id='flavors') then
    insert into public.option_groups(product_id,source_group_id,name,min_select,max_select,required,selection_type,position)
    values(product_uuid,'flavors','Variações',1,1,true,'single',999)
    returning id into group_uuid;
    insert into public.product_options(group_id,source_option_id,name,price_delta,position)
    values(group_uuid,'75','MARMITA GRANDE',0,10);
  end if;
end $$;
