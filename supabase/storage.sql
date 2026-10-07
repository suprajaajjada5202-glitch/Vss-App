-- Storage buckets and policies. Run after schema.sql (re-runnable).
--
--   avatars     public read; each user writes only inside  <user_id>/...
--   chat-files  private; objects live under  <chat_id>/<uuid>-<file name>
--               and are readable/writable only by members of that chat
--               (announcement channel: everyone reads, admins write).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('chat-files', 'chat-files', false, 10485760, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Folder name -> chat id, or null when the first path segment is not a uuid.
create or replace function public.chat_id_from_path(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(p_name))[1])::uuid
    else null
  end
$$;

-- Avatars -------------------------------------------------------------------
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_owner_write on storage.objects;
create policy avatars_owner_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Chat files ----------------------------------------------------------------
drop policy if exists chat_files_member_read on storage.objects;
create policy chat_files_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-files'
    and public.chat_id_from_path(name) is not null
    and public.is_chat_member(public.chat_id_from_path(name))
  );

drop policy if exists chat_files_upload on storage.objects;
create policy chat_files_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-files'
    and public.chat_id_from_path(name) is not null
    and public.can_post_chat(public.chat_id_from_path(name))
  );
