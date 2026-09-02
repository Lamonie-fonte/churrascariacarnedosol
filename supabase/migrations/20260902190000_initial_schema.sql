-- CHURRASCARIA CARNE DE SOL — schema inicial isolado
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_settings (
  id boolean primary key default true check (id),
  name text not null default 'CHURRASCARIA CARNE DE SOL',
  support_email text not null default 'churrascariacarnedosolgold@gmail.com',
  whatsapp text not null default '5585986129964',
  address text not null default 'Av. Castelo de Castro, 643 - Jangurussu',
  city text not null default 'Fortaleza',
  state text not null default 'CE',
  zip_code text not null default '60866-681',
  opening_hours jsonb not null default '{"0":["07:00","15:00"],"1":["07:00","15:00"],"2":["07:00","15:00"],"3":["07:00","15:00"],"4":["07:00","15:00"],"5":["07:00","15:00"],"6":["07:00","15:00"]}'::jsonb,
  manual_status text not null default 'auto' check (manual_status in ('auto','open','closed')),
  maintenance_mode boolean not null default false,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  minimum_order numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  banner_title text not null default 'Sabor de brasa, comida de verdade',
  banner_text text not null default 'Marmitas, galetos, carnes e combos preparados todos os dias.',
  logo_url text,
  theme jsonb not null default '{"ember":"#ff6b1a","coal":"#18120f","cream":"#fff7ec","gold":"#f4b942"}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  name text not null,
  slug text not null unique,
  description text,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  source_id text unique,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  price numeric(10,2),
  old_price numeric(10,2),
  image_url text,
  active boolean not null default true,
  featured boolean not null default false,
  stock integer,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price is null or price >= 0),
  check (old_price is null or old_price >= 0),
  unique(category_id, slug)
);

create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  source_group_id text,
  name text not null,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  required boolean not null default false,
  selection_type text not null default 'single' check (selection_type in ('single','multiple')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique(product_id, source_group_id)
);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups(id) on delete cascade,
  source_option_id text,
  name text not null,
  price_delta numeric(10,2) not null default 0,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  email text,
  phone text not null,
  order_type text not null check (order_type in ('delivery','pickup')),
  status text not null default 'pending' check (status in ('pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled')),
  payment_method text not null check (payment_method in ('pix','cash','card')),
  subtotal numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  address jsonb,
  change_for numeric(10,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  unit_price numeric(10,2) not null,
  selections jsonb not null default '[]'::jsonb,
  line_total numeric(10,2) not null
);

create index products_category_position_idx on public.products(category_id, position) where active;
create index products_category_fk_idx on public.products(category_id);
create index option_groups_product_idx on public.option_groups(product_id, position);
create index product_options_group_idx on public.product_options(group_id, position) where active;
create index orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at desc);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger store_settings_updated_at before update on public.store_settings for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,full_name,phone,role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'phone',''),
    case when lower(coalesce(new.email,'')) = 'churrascariacarnedosolgold@gmail.com' then 'admin' else 'customer' end
  )
  on conflict (id) do update set email=excluded.email;
  return new;
end; $$;

create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute function public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin');
$$;
revoke execute on function private.is_admin() from public, anon, authenticated, service_role;

create or replace function public.create_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_unit numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_delivery numeric(10,2) := 0;
  v_settings public.store_settings;
  v_selection jsonb;
  v_option record;
  v_selected_ids uuid[];
  v_count integer;
  v_group record;
begin
  select * into v_settings from public.store_settings where id=true;
  if v_settings.maintenance_mode then raise exception 'Loja em manutenção'; end if;
  if jsonb_array_length(coalesce(payload->'items','[]'::jsonb)) = 0 then raise exception 'Carrinho vazio'; end if;
  if length(trim(coalesce(payload->>'customer_name',''))) < 2 then raise exception 'Nome inválido'; end if;
  if length(regexp_replace(coalesce(payload->>'phone',''),'\D','','g')) < 10 then raise exception 'Telefone inválido'; end if;
  if payload->>'order_type' not in ('delivery','pickup') then raise exception 'Tipo de pedido inválido'; end if;
  if payload->>'payment_method' not in ('pix','cash','card') then raise exception 'Pagamento inválido'; end if;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_qty := greatest(1, least(99, coalesce((v_item->>'quantity')::integer,1)));
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active;
    if not found then raise exception 'Produto indisponível'; end if;
    v_unit := coalesce(v_product.price,0);
    v_selected_ids := array(select jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb))::uuid);

    for v_group in select * from public.option_groups where product_id=v_product.id loop
      select count(*) into v_count from public.product_options o where o.group_id=v_group.id and o.active and o.id=any(v_selected_ids);
      if v_count < v_group.min_select or v_count > v_group.max_select then raise exception 'Seleção inválida em %', v_group.name; end if;
    end loop;
    for v_option in select o.id,o.name,o.price_delta,g.name group_name from public.product_options o join public.option_groups g on g.id=o.group_id where g.product_id=v_product.id and o.active and o.id=any(v_selected_ids) loop
      v_unit := v_unit + v_option.price_delta;
    end loop;
    if v_unit <= 0 then raise exception 'Preço não configurado'; end if;
    v_subtotal := v_subtotal + (v_unit * v_qty);
  end loop;

  if v_subtotal < v_settings.minimum_order then raise exception 'Pedido mínimo não atingido'; end if;
  if payload->>'order_type'='delivery' then
    if not v_settings.delivery_enabled then raise exception 'Entrega indisponível'; end if;
    v_delivery := v_settings.delivery_fee;
  elsif not v_settings.pickup_enabled then raise exception 'Retirada indisponível'; end if;

  insert into public.orders(customer_id,customer_name,email,phone,order_type,payment_method,subtotal,delivery_fee,total,address,change_for,notes)
  values(auth.uid(),trim(payload->>'customer_name'),nullif(trim(payload->>'email'),''),regexp_replace(payload->>'phone','\D','','g'),payload->>'order_type',payload->>'payment_method',v_subtotal,v_delivery,v_subtotal+v_delivery,payload->'address',nullif(payload->>'change_for','')::numeric,left(coalesce(payload->>'notes',''),500))
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_qty := greatest(1, least(99, coalesce((v_item->>'quantity')::integer,1)));
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid;
    v_unit := coalesce(v_product.price,0);
    v_selected_ids := array(select jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb))::uuid);
    v_selection := '[]'::jsonb;
    for v_option in select o.id,o.name,o.price_delta,g.name group_name from public.product_options o join public.option_groups g on g.id=o.group_id where g.product_id=v_product.id and o.active and o.id=any(v_selected_ids) loop
      v_unit := v_unit + v_option.price_delta;
      v_selection := v_selection || jsonb_build_array(jsonb_build_object('id',v_option.id,'group',v_option.group_name,'name',v_option.name,'price',v_option.price_delta));
    end loop;
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,selections,line_total)
    values(v_order.id,v_product.id,v_product.name,v_qty,v_unit,v_selection,v_unit*v_qty);
  end loop;
  return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'total',v_order.total);
end; $$;

alter table public.profiles enable row level security;
alter table public.store_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.option_groups enable row level security;
alter table public.product_options enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "public read store" on public.store_settings for select using (true);
create policy "public read active categories" on public.categories for select using (active or (select private.is_admin()));
create policy "public read active products" on public.products for select using (active or (select private.is_admin()));
create policy "public read option groups" on public.option_groups for select using (exists(select 1 from public.products p where p.id=product_id and (p.active or (select private.is_admin()))));
create policy "public read active options" on public.product_options for select using (active or (select private.is_admin()));
create policy "profile self read" on public.profiles for select using (id=(select auth.uid()) or (select private.is_admin()));
create policy "profile self update" on public.profiles for update using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy "orders own read" on public.orders for select using (customer_id=(select auth.uid()) or (select private.is_admin()));
create policy "order items own read" on public.order_items for select using (exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=(select auth.uid()) or (select private.is_admin()))));

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
create policy "admin orders write" on public.orders for update using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;
revoke update on public.profiles from authenticated;
grant update(full_name,phone) on public.profiles to authenticated;

insert into public.store_settings(id) values(true) on conflict do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "public view product images" on storage.objects for select using (bucket_id='product-images');
create policy "admins upload product images" on storage.objects for insert to authenticated with check (bucket_id='product-images' and (select private.is_admin()));
create policy "admins update product images" on storage.objects for update to authenticated using (bucket_id='product-images' and (select private.is_admin())) with check (bucket_id='product-images' and (select private.is_admin()));
create policy "admins delete product images" on storage.objects for delete to authenticated using (bucket_id='product-images' and (select private.is_admin()));
