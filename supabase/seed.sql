-- Bootstrap: make the first person a Super Admin. Run in the Supabase SQL editor
-- AFTER schema.sql and storage.sql. Safe to re-run.
--
--   1. Authentication -> Users -> "Add user" -> email + password, tick "Auto Confirm User".
--   2. Change `target` below to that email, then run this script.
--
-- After that, sign in to the app and add everyone else from Employees -> Add employee.

-- Backfill: people created in Supabase Auth before schema.sql ran have no app rows yet.
insert into public.users (id, email, role_id)
select u.id, u.email, (select id from public.roles where name = 'employee')
from auth.users u
on conflict (id) do nothing;

insert into public.profiles (id, full_name)
select u.id, coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

insert into public.employees (user_id, employee_code, hire_date)
select u.id, 'VSS-' || lpad(nextval('public.employee_code_seq')::text, 4, '0'), current_date
from auth.users u
where not exists (select 1 from public.employees e where e.user_id = u.id);

insert into public.chat_participants (chat_id, user_id)
select '00000000-0000-0000-0000-000000000001', u.id
from auth.users u
on conflict (chat_id, user_id) do nothing;

-- Promote.
do $$
declare
  target text := 'admin@your-company.com';  -- <== CHANGE THIS
  promoted integer;
begin
  update public.users
  set role_id = (select id from public.roles where name = 'super_admin')
  where lower(email) = lower(target);

  get diagnostics promoted = row_count;
  if promoted = 0 then
    raise exception 'No user with email "%". Create them under Authentication -> Users first, then edit `target` above.', target;
  end if;
end $$;
