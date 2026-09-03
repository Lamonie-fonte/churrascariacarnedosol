-- O cliente nunca pode alterar o próprio bloqueio; somente esta RPC administrativa.
create or replace function private.set_customer_block_impl(customer_uuid uuid,blocked boolean,reason text default null)
returns public.profiles language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;
begin
  if not (select private.is_admin()) then raise exception 'Acesso negado'; end if;
  update public.profiles
     set is_blocked=blocked,
         blocked_at=case when blocked then now() else null end,
         blocked_reason=case when blocked then nullif(left(trim(coalesce(reason,'')),300),'') else null end
   where id=customer_uuid and role='customer'
   returning * into v_profile;
  if not found then raise exception 'Cliente não encontrado'; end if;
  return v_profile;
end; $$;
revoke all on function private.set_customer_block_impl(uuid,boolean,text) from public,anon;
grant execute on function private.set_customer_block_impl(uuid,boolean,text) to authenticated;

create or replace function public.set_customer_block(customer_uuid uuid,blocked boolean,reason text default null)
returns public.profiles language sql security invoker set search_path='' as $$
  select private.set_customer_block_impl(customer_uuid,blocked,reason);
$$;
revoke all on function public.set_customer_block(uuid,boolean,text) from public,anon;
grant execute on function public.set_customer_block(uuid,boolean,text) to authenticated;

