-- Fecha o fluxo ponta a ponta em produção: pagamento detalhado, idempotência concorrente,
-- validação de opções e nomes sem capitalização corrompida.
alter table public.orders add column if not exists payment_detail text;
alter table public.orders drop constraint if exists orders_payment_detail_check;
alter table public.orders add constraint orders_payment_detail_check
  check (payment_detail is null or payment_detail in ('debit','credit'));

update public.categories set name=lower(name),source_name=lower(source_name);
update public.products set name=lower(name);
update public.order_items set product_name=lower(product_name);
update public.option_groups set selection_type='single' where max_select=1;

create or replace function private.create_order_impl(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders;
  v_existing public.orders;
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
  v_uid uuid := auth.uid();
  v_request_id uuid;
  v_address jsonb;
  v_address_id uuid;
  v_profile public.profiles;
  v_payment_detail text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para enviar o pedido'; end if;

  select * into v_profile from public.profiles where id=v_uid;
  if not found then raise exception 'Cadastro do cliente não encontrado'; end if;
  if v_profile.is_blocked then raise exception 'Sua conta está bloqueada. Fale com o estabelecimento'; end if;

  begin
    v_request_id := (payload->>'client_request_id')::uuid;
  exception when others then
    raise exception 'Identificador do pedido inválido';
  end;
  if v_request_id is null then raise exception 'Identificador do pedido ausente'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':' || v_request_id::text,0));
  select * into v_existing from public.orders where customer_id=v_uid and client_request_id=v_request_id;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'order_number',v_existing.order_number,
      'subtotal',v_existing.subtotal,'delivery_fee',v_existing.delivery_fee,
      'total',v_existing.total,'status',v_existing.status,'created_at',v_existing.created_at,
      'delivery_eta_minutes',v_existing.delivery_eta_minutes,'payment_detail',v_existing.payment_detail,
      'already_existed',true
    );
  end if;

  select * into v_settings from public.store_settings where id=true;
  if v_settings.maintenance_mode then raise exception 'Loja temporariamente fechada para pedidos'; end if;
  if jsonb_array_length(coalesce(payload->'items','[]'::jsonb))=0 then raise exception 'Carrinho vazio'; end if;
  if length(trim(coalesce(payload->>'customer_name','')))<2 then raise exception 'Nome inválido'; end if;
  if length(regexp_replace(coalesce(payload->>'phone',''),'\D','','g'))<10 then raise exception 'Telefone inválido'; end if;
  if payload->>'order_type' not in ('delivery','pickup') then raise exception 'Tipo de pedido inválido'; end if;
  if payload->>'payment_method' not in ('pix','cash','card') then raise exception 'Pagamento inválido'; end if;
  v_payment_detail := case when payload->>'payment_method'='card' then nullif(payload->>'payment_detail','') else null end;
  if v_payment_detail is not null and v_payment_detail not in ('debit','credit') then raise exception 'Tipo de cartão inválido'; end if;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_qty := greatest(1,least(99,coalesce((v_item->>'quantity')::integer,1)));
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active;
    if not found then raise exception 'Produto indisponível'; end if;
    v_unit := coalesce(v_product.price,0);
    v_selected_ids := array(select jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb))::uuid);

    if exists (
      select 1 from unnest(v_selected_ids) selected_id
      where not exists (
        select 1 from public.product_options o join public.option_groups g on g.id=o.group_id
        where o.id=selected_id and o.active and g.product_id=v_product.id
      )
    ) then raise exception 'Opção inválida para o produto %',v_product.name; end if;

    for v_group in select * from public.option_groups where product_id=v_product.id loop
      select count(*) into v_count from public.product_options o
       where o.group_id=v_group.id and o.active and o.id=any(v_selected_ids);
      if v_count<v_group.min_select or v_count>v_group.max_select then
        raise exception 'Seleção inválida em %',v_group.name;
      end if;
    end loop;
    for v_option in
      select o.id,o.name,o.price_delta,g.name group_name
      from public.product_options o join public.option_groups g on g.id=o.group_id
      where g.product_id=v_product.id and o.active and o.id=any(v_selected_ids)
    loop
      v_unit := v_unit+v_option.price_delta;
    end loop;
    if v_unit<=0 then raise exception 'Preço não configurado'; end if;
    v_subtotal := v_subtotal+(v_unit*v_qty);
  end loop;

  if v_subtotal<v_settings.minimum_order then raise exception 'Pedido mínimo não atingido'; end if;
  if payload->>'order_type'='delivery' then
    if not v_settings.delivery_enabled then raise exception 'Entrega indisponível'; end if;
    v_address := payload->'address';
    if v_address is null
       or length(regexp_replace(coalesce(v_address->>'postal_code',''),'\D','','g'))<>8
       or length(trim(coalesce(v_address->>'street','')))<2
       or length(trim(coalesce(v_address->>'number','')))<1
       or length(trim(coalesce(v_address->>'neighborhood','')))<2
       or length(trim(coalesce(v_address->>'city','')))<2
       or length(trim(coalesce(v_address->>'state','')))<>2 then
      raise exception 'Endereço de entrega incompleto';
    end if;
    v_delivery := v_settings.delivery_fee;
  elsif not v_settings.pickup_enabled then
    raise exception 'Retirada indisponível';
  end if;

  update public.profiles
     set full_name=trim(payload->>'customer_name'),phone=regexp_replace(payload->>'phone','\D','','g')
   where id=v_uid;

  if payload->>'order_type'='delivery' and coalesce((payload->>'save_address')::boolean,false) then
    begin v_address_id := nullif(payload->>'address_id','')::uuid;
    exception when others then raise exception 'Endereço salvo inválido'; end;
    if v_address_id is not null then
      update public.saved_addresses set
        label=left(coalesce(nullif(trim(payload->>'address_label'),''),'Casa'),40),
        postal_code=v_address->>'postal_code',street=trim(v_address->>'street'),number=trim(v_address->>'number'),
        complement=nullif(trim(v_address->>'complement'),''),neighborhood=trim(v_address->>'neighborhood'),
        city=trim(v_address->>'city'),state=upper(trim(v_address->>'state')),
        reference=nullif(trim(v_address->>'reference'),''),
        is_default=coalesce((payload->>'set_default_address')::boolean,false),last_used_at=now()
       where id=v_address_id and user_id=v_uid;
      if not found then raise exception 'Endereço salvo não pertence ao cliente'; end if;
    else
      insert into public.saved_addresses(
        user_id,label,postal_code,street,number,complement,neighborhood,city,state,reference,is_default,last_used_at
      ) values (
        v_uid,left(coalesce(nullif(trim(payload->>'address_label'),''),'Casa'),40),
        v_address->>'postal_code',trim(v_address->>'street'),trim(v_address->>'number'),
        nullif(trim(v_address->>'complement'),''),trim(v_address->>'neighborhood'),trim(v_address->>'city'),
        upper(trim(v_address->>'state')),nullif(trim(v_address->>'reference'),''),
        coalesce((payload->>'set_default_address')::boolean,false)
          or not exists(select 1 from public.saved_addresses where user_id=v_uid),now()
      ) returning id into v_address_id;
    end if;
  end if;

  insert into public.orders(
    customer_id,client_request_id,customer_name,email,phone,order_type,payment_method,payment_detail,
    subtotal,delivery_fee,total,address,change_for,notes,delivery_eta_minutes
  ) values (
    v_uid,v_request_id,trim(payload->>'customer_name'),nullif(trim(payload->>'email'),''),
    regexp_replace(payload->>'phone','\D','','g'),payload->>'order_type',payload->>'payment_method',v_payment_detail,
    v_subtotal,v_delivery,v_subtotal+v_delivery,v_address,
    case when payload->>'payment_method'='cash' then nullif(payload->>'change_for','')::numeric else null end,
    left(coalesce(payload->>'notes',''),500),v_settings.delivery_eta_minutes
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_qty := greatest(1,least(99,coalesce((v_item->>'quantity')::integer,1)));
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid;
    v_unit := coalesce(v_product.price,0);
    v_selected_ids := array(select jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb))::uuid);
    v_selection := '[]'::jsonb;
    for v_option in
      select o.id,o.name,o.price_delta,g.name group_name
      from public.product_options o join public.option_groups g on g.id=o.group_id
      where g.product_id=v_product.id and o.active and o.id=any(v_selected_ids)
    loop
      v_unit := v_unit+v_option.price_delta;
      v_selection := v_selection || jsonb_build_array(jsonb_build_object(
        'id',v_option.id,'group',v_option.group_name,'name',v_option.name,'price',v_option.price_delta
      ));
    end loop;
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,selections,line_total,notes)
    values(v_order.id,v_product.id,v_product.name,v_qty,v_unit,v_selection,v_unit*v_qty,left(coalesce(v_item->>'notes',''),200));
  end loop;

  return jsonb_build_object(
    'id',v_order.id,'order_number',v_order.order_number,
    'subtotal',v_order.subtotal,'delivery_fee',v_order.delivery_fee,'total',v_order.total,
    'status',v_order.status,'created_at',v_order.created_at,'delivery_eta_minutes',v_order.delivery_eta_minutes,
    'payment_detail',v_order.payment_detail,'address_id',v_address_id,'already_existed',false
  );
end; $$;

revoke all on function private.create_order_impl(jsonb) from public,anon;
grant execute on function private.create_order_impl(jsonb) to authenticated;
revoke all on function public.create_order(jsonb) from public,anon;
grant execute on function public.create_order(jsonb) to authenticated;
