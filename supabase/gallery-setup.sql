insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kedai-gallery',
  'kedai-gallery',
  true,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view Kedai Toogi gallery" on storage.objects;
create policy "Public can view Kedai Toogi gallery"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'kedai-gallery');

drop policy if exists "Owners can upload Kedai Toogi gallery photos" on storage.objects;
create policy "Owners can upload Kedai Toogi gallery photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'kedai-gallery'
  and exists (
    select 1
    from public.profil
    where profil.id = auth.uid()
      and profil.aktif is true
      and lower(profil.peran) in ('owner', 'pemilik')
  )
);

drop policy if exists "Owners can delete Kedai Toogi gallery photos" on storage.objects;
create policy "Owners can delete Kedai Toogi gallery photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'kedai-gallery'
  and exists (
    select 1
    from public.profil
    where profil.id = auth.uid()
      and profil.aktif is true
      and lower(profil.peran) in ('owner', 'pemilik')
  )
);
