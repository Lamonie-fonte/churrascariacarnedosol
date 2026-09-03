-- Impede que o perfil aponte para conteúdo externo ou para a pasta de outro cliente.
update public.profiles
set avatar_url=null
where avatar_url is not null
  and avatar_url not like (
    'https://pghbhyvhfiwdpyykikff.supabase.co/storage/v1/object/public/avatars/' || id::text || '/avatar-%.jpg'
  );

alter table public.profiles drop constraint if exists profiles_avatar_own_bucket_check;
alter table public.profiles add constraint profiles_avatar_own_bucket_check check (
  avatar_url is null
  or avatar_url like (
    'https://pghbhyvhfiwdpyykikff.supabase.co/storage/v1/object/public/avatars/' || id::text || '/avatar-%.jpg'
  )
);
