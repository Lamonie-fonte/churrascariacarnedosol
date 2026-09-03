-- Foto de perfil pública, sempre isolada na pasta do próprio usuário.
alter table public.profiles add column if not exists avatar_url text;
revoke update on public.profiles from authenticated;
grant update(full_name,phone,avatar_url) on public.profiles to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'avatars','avatars',true,26214400,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','image/bmp','image/tiff']
)
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "public view avatars" on storage.objects;
create policy "public view avatars" on storage.objects
for select to public using (bucket_id='avatars');

drop policy if exists "customers upload own avatar" on storage.objects;
create policy "customers upload own avatar" on storage.objects
for insert to authenticated with check (
  bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "customers update own avatar" on storage.objects;
create policy "customers update own avatar" on storage.objects
for update to authenticated using (
  bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
) with check (
  bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "customers delete own avatar" on storage.objects;
create policy "customers delete own avatar" on storage.objects
for delete to authenticated using (
  bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
);
