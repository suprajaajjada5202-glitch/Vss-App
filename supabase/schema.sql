-- VSS Pulse — Supabase schema
-- Run once in the Supabase SQL editor (safe to re-run; it is idempotent).
-- Then run storage.sql, then seed.sql.
--
-- Design notes
--  * Every table that the UI joins to a person references public.profiles(id),
--    not public.users(id). PostgREST can only embed `profiles(...)` through a
--    direct foreign key, and profiles.id cascades from users.id from auth.users.
--  * Clients (anon key + user JWT) never write role / membership data directly.
--    Privileged changes go through guarded triggers or SECURITY DEFINER RPCs.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_status as enum ('active', 'inactive', 'on_leave');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'blocked', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_type as enum ('direct', 'group', 'announcement');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum (
    'task_assigned',
    'task_status',
    'chat_message',
    'profile_updated',
    'announcement',
    'system'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('super_admin', 'admin', 'manager', 'employee')),
  display_name text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.roles (name, display_name, description, permissions)
values
  (
    'super_admin',
    'Super Admin',
    'Full platform control including roles and audit.',
    '{"employees":["create","read","update","delete"],"tasks":["create","read","update","delete"],"reports":["read"],"chat":["read","write","announce"],"roles":["manage"]}'::jsonb
  ),
  (
    'admin',
    'Admin',
    'Manage employees, tasks, and company operations.',
    '{"employees":["create","read","update","delete"],"tasks":["create","read","update","delete"],"reports":["read"],"chat":["read","write","announce"]}'::jsonb
  ),
  (
    'manager',
    'Manager',
    'Lead a team, assign work, and review productivity.',
    '{"employees":["read"],"tasks":["create","read","update"],"reports":["read"],"chat":["read","write"]}'::jsonb
  ),
  (
    'employee',
    'Employee',
    'Own profile, assigned work, and team chat.',
    '{"employees":["read"],"tasks":["read","update"],"reports":["read_own"],"chat":["read","write"]}'::jsonb
  )
on conflict (name) do update
set display_name = excluded.display_name,
    description = excluded.description,
    permissions = excluded.permissions;

-- ---------------------------------------------------------------------------
-- People: users (1:1 with auth.users) -> profiles -> employees
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role_id uuid not null references public.roles (id),
  status public.user_status not null default 'active',
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references public.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  avatar_url text check (avatar_url is null or avatar_url ~* '^https?://'),
  phone text,
  job_title text,
  department text,
  location text,
  bio text check (bio is null or char_length(bio) <= 1000),
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.employee_code_seq start 1001;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  employee_code text not null unique,
  hire_date date,
  manager_id uuid references public.employees (id) on delete set null,
  employment_type text default 'full_time',
  skills text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text check (description is null or char_length(description) <= 5000),
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  progress integer not null default 0 check (progress between 0 and 100),
  due_date date,
  created_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  type public.chat_type not null,
  name text,
  direct_key text unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.chats (id, type, name)
values ('00000000-0000-0000-0000-000000000001', 'announcement', 'Company announcements')
on conflict (id) do nothing;

create table if not exists public.chat_participants (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  unique (chat_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text check (body is null or char_length(body) <= 4000),
  file_path text,
  file_name text,
  file_size bigint,
  created_at timestamptz not null default now(),
  check (nullif(btrim(coalesce(body, '')), '') is not null or file_path is not null)
);

-- ---------------------------------------------------------------------------
-- Notifications & audit
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_users_role on public.users (role_id);
create index if not exists idx_profiles_department on public.profiles (department);
create index if not exists idx_employees_manager on public.employees (manager_id);
create index if not exists idx_tasks_status on public.tasks (status);
create index if not exists idx_tasks_due on public.tasks (due_date);
create index if not exists idx_tasks_created_by on public.tasks (created_by);
create index if not exists idx_tasks_created_at on public.tasks (created_at desc);
create index if not exists idx_tasks_completed_at on public.tasks (completed_at) where completed_at is not null;
create index if not exists idx_task_assignments_user on public.task_assignments (user_id);
create index if not exists idx_task_comments_task on public.task_comments (task_id, created_at);
create index if not exists idx_task_history_task on public.task_history (task_id, created_at desc);
create index if not exists idx_chat_participants_user on public.chat_participants (user_id);
create index if not exists idx_chat_messages_chat on public.chat_messages (chat_id, created_at);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications (user_id) where read_at is null;
create index if not exists idx_activity_created on public.activity_logs (created_at desc);
create index if not exists idx_activity_actor on public.activity_logs (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_touch on public.users;
create trigger users_touch before update on public.users
for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees
for each row execute function public.touch_updated_at();

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auth bootstrap: every auth.users row gets users/profiles/employees rows and
-- joins the announcement channel. Role is always `employee` here; only an
-- admin (or the service role) can change it afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_role uuid;
begin
  select id into default_role from public.roles where name = 'employee' limit 1;

  insert into public.users (id, email, role_id)
  values (new.id, new.email, default_role)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.employees (user_id, employee_code, hire_date)
  values (new.id, 'VSS-' || lpad(nextval('public.employee_code_seq')::text, 4, '0'), current_date)
  on conflict (user_id) do nothing;

  -- Self-heal: signups must never fail because the announcement channel went missing.
  insert into public.chats (id, type, name)
  values ('00000000-0000-0000-0000-000000000001', 'announcement', 'Company announcements')
  on conflict (id) do nothing;

  insert into public.chat_participants (chat_id, user_id)
  values ('00000000-0000-0000-0000-000000000001', new.id)
  on conflict (chat_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so policies can call them without RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = auth.uid()
$$;

create or replace function public.user_role_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = p_user
$$;

create or replace function public.has_role(allowed text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_name() = any (allowed), false)
$$;

create or replace function public.is_task_assignee(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.task_assignments
    where task_id = p_task and user_id = auth.uid()
  )
$$;

create or replace function public.is_chat_member(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chats c
    where c.id = p_chat
      and (
        c.type = 'announcement'
        or exists (
          select 1 from public.chat_participants p
          where p.chat_id = c.id and p.user_id = auth.uid()
        )
      )
  )
$$;

-- Members can post everywhere except the announcement channel (admins only).
create or replace function public.can_post_chat(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_chat_member(p_chat)
    and (
      (select c.type from public.chats c where c.id = p_chat) <> 'announcement'
      or public.has_role(array['super_admin', 'admin'])
    )
$$;

-- ---------------------------------------------------------------------------
-- Guard: role / status / email changes on public.users
-- auth.uid() is null for the service role and the SQL editor, which stay unrestricted.
-- ---------------------------------------------------------------------------
create or replace function public.guard_user_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_role text;
  new_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'User id is immutable';
  end if;

  if new.role_id is distinct from old.role_id
     or new.status is distinct from old.status
     or new.email is distinct from old.email then

    if not public.has_role(array['super_admin', 'admin']) then
      raise exception 'Only an admin can change roles, status or email'
        using errcode = '42501';
    end if;

    select name into old_role from public.roles where id = old.role_id;
    select name into new_role from public.roles where id = new.role_id;

    if (old_role = 'super_admin' or new_role = 'super_admin')
       and not public.has_role(array['super_admin']) then
      raise exception 'Only a Super Admin can grant, revoke or modify Super Admin'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists users_guard on public.users;
create trigger users_guard before update on public.users
for each row execute function public.guard_user_changes();

create or replace function public.audit_user_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role_id is distinct from old.role_id then
    insert into public.activity_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'user_role_changed', 'user', new.id,
      jsonb_build_object(
        'from', (select name from public.roles where id = old.role_id),
        'to', (select name from public.roles where id = new.role_id)
      )
    );
  end if;
  if new.status is distinct from old.status then
    insert into public.activity_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'user_status_changed', 'user', new.id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists users_audit on public.users;
create trigger users_audit after update on public.users
for each row execute function public.audit_user_changes();

-- ---------------------------------------------------------------------------
-- Tasks: guard + completion bookkeeping (BEFORE), history + notifications (AFTER).
-- History rows reference the task, so they can only be written once it exists.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
as $$
declare
  is_manager boolean;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null then
      is_manager := public.has_role(array['super_admin', 'admin', 'manager']);

      -- Assignees may only move status / progress; everything else is for managers.
      if not is_manager
         and (to_jsonb(new) - 'status' - 'progress' - 'completed_at' - 'updated_at')
             is distinct from
             (to_jsonb(old) - 'status' - 'progress' - 'completed_at' - 'updated_at') then
        raise exception 'Assignees can only update status and progress'
          using errcode = '42501';
      end if;
    end if;

    -- created_by is fixed, except when the creator's account is deleted
    -- (ON DELETE SET NULL runs as an UPDATE with no auth.uid()).
    if new.created_by is distinct from old.created_by
       and not (new.created_by is null and auth.uid() is null) then
      raise exception 'created_by is immutable' using errcode = '42501';
    end if;

    if new.status = 'completed' then
      new.progress := 100;
      if old.status <> 'completed' then
        new.completed_at := now();
      end if;
    elsif old.status = 'completed' then
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_log_change on public.tasks;
drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
before update on public.tasks
for each row execute function public.tasks_before_write();

create or replace function public.tasks_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  changed jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.task_history (task_id, user_id, action, details)
    values (new.id, coalesce(actor, new.created_by), 'created',
            jsonb_build_object('title', new.title, 'priority', new.priority));
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.task_history (task_id, user_id, action, details)
    values (new.id, actor, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));

    insert into public.notifications (user_id, type, title, body, link)
    select r.uid, 'task_status', 'Task status updated',
           new.title || ' is now ' || replace(new.status::text, '_', ' '),
           '/tasks/' || new.id::text
    from (
      select user_id as uid from public.task_assignments where task_id = new.id
      union
      select new.created_by
    ) r
    where r.uid is not null and r.uid is distinct from actor;
  end if;

  if old.progress is distinct from new.progress and new.status is not distinct from old.status then
    insert into public.task_history (task_id, user_id, action, details)
    values (new.id, actor, 'progress_updated', jsonb_build_object('from', old.progress, 'to', new.progress));
  end if;

  changed := jsonb_strip_nulls(jsonb_build_object(
    'title', case when old.title is distinct from new.title
                  then jsonb_build_object('from', old.title, 'to', new.title) end,
    'priority', case when old.priority is distinct from new.priority
                     then jsonb_build_object('from', old.priority, 'to', new.priority) end,
    'due_date', case when old.due_date is distinct from new.due_date
                     then jsonb_build_object('from', old.due_date, 'to', new.due_date) end,
    'description', case when old.description is distinct from new.description
                        then jsonb_build_object('changed', true) end
  ));
  if changed <> '{}'::jsonb then
    insert into public.task_history (task_id, user_id, action, details)
    values (new.id, actor, 'updated', changed);
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_after_write on public.tasks;
create trigger tasks_after_write
after insert or update on public.tasks
for each row execute function public.tasks_after_write();

-- Assignment history + notification.
create or replace function public.task_assignment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ttitle text;
begin
  if tg_op = 'INSERT' then
    select title into ttitle from public.tasks where id = new.task_id;

    insert into public.task_history (task_id, user_id, action, details)
    values (new.task_id, new.assigned_by, 'assigned', jsonb_build_object('user_id', new.user_id));

    if new.user_id is distinct from new.assigned_by then
      insert into public.notifications (user_id, type, title, body, link)
      values (new.user_id, 'task_assigned', 'New task assigned', coalesce(ttitle, 'A task'),
              '/tasks/' || new.task_id::text);
    end if;
    return new;
  end if;

  -- DELETE: skip when the whole task is being deleted (cascade).
  if exists (select 1 from public.tasks where id = old.task_id) then
    insert into public.task_history (task_id, user_id, action, details)
    values (old.task_id, auth.uid(), 'unassigned', jsonb_build_object('user_id', old.user_id));
  end if;
  return old;
end;
$$;

drop trigger if exists task_assignments_notify on public.task_assignments;
drop trigger if exists task_assignments_changed on public.task_assignments;
create trigger task_assignments_changed
after insert or delete on public.task_assignments
for each row execute function public.task_assignment_changed();

-- ---------------------------------------------------------------------------
-- Chat notifications. One unread notification per chat per person: later
-- messages refresh it instead of piling up.
-- ---------------------------------------------------------------------------
create or replace function public.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ctype public.chat_type;
  ntype public.notification_type;
  ntitle text;
  nlink text;
  preview text;
begin
  select type into ctype from public.chats where id = new.chat_id;
  if ctype = 'announcement' then
    ntype := 'announcement';
    ntitle := 'Company announcement';
  else
    ntype := 'chat_message';
    ntitle := 'New chat message';
  end if;
  nlink := '/chat?c=' || new.chat_id::text;
  preview := left(coalesce(nullif(btrim(new.body), ''), new.file_name, 'Attachment'), 140);

  update public.notifications n
  set body = preview, created_at = now()
  where n.type = ntype
    and n.link = nlink
    and n.read_at is null
    and n.user_id in (
      select user_id from public.chat_participants
      where chat_id = new.chat_id and user_id <> new.sender_id
    );

  insert into public.notifications (user_id, type, title, body, link)
  select p.user_id, ntype, ntitle, preview, nlink
  from public.chat_participants p
  where p.chat_id = new.chat_id
    and p.user_id <> new.sender_id
    and not exists (
      select 1 from public.notifications n
      where n.user_id = p.user_id and n.type = ntype and n.link = nlink and n.read_at is null
    );

  return new;
end;
$$;

drop trigger if exists chat_messages_notify on public.chat_messages;
create trigger chat_messages_notify
after insert on public.chat_messages
for each row execute function public.notify_chat_message();

-- ---------------------------------------------------------------------------
-- Chat RPCs. Membership is only ever written here (and by the service role).
-- ---------------------------------------------------------------------------
create or replace function public.open_direct_chat(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
  cid uuid;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_other is null or p_other = me then
    raise exception 'Pick someone else to message';
  end if;
  if not exists (select 1 from public.users where id = p_other and status <> 'inactive') then
    raise exception 'That person is not available';
  end if;

  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);

  select id into cid from public.chats where direct_key = k;
  if cid is null then
    insert into public.chats (type, created_by, direct_key)
    values ('direct', me, k)
    on conflict (direct_key) do nothing
    returning id into cid;
    if cid is null then
      select id into cid from public.chats where direct_key = k;
    end if;
  end if;

  insert into public.chat_participants (chat_id, user_id)
  values (cid, me), (cid, p_other)
  on conflict (chat_id, user_id) do nothing;

  return cid;
end;
$$;

create or replace function public.create_group_chat(p_name text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  cid uuid;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if char_length(nm) not between 1 and 80 then
    raise exception 'Group name must be 1 to 80 characters';
  end if;
  if coalesce(array_length(p_members, 1), 0) > 200 then
    raise exception 'A group can have at most 200 members';
  end if;

  insert into public.chats (type, name, created_by)
  values ('group', nm, me)
  returning id into cid;

  insert into public.chat_participants (chat_id, user_id)
  select cid, u.id
  from public.users u
  where u.id = me
     or (u.id = any (coalesce(p_members, '{}'::uuid[])) and u.status <> 'inactive')
  on conflict (chat_id, user_id) do nothing;

  return cid;
end;
$$;

create or replace function public.mark_chat_read(p_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_chat_member(p_chat) then
    return;
  end if;
  insert into public.chat_participants (chat_id, user_id, last_read_at)
  values (p_chat, auth.uid(), now())
  on conflict (chat_id, user_id) do update set last_read_at = now();

  update public.notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and type in ('chat_message', 'announcement')
    and link = '/chat?c=' || p_chat::text;
end;
$$;

-- Sidebar for the chat page in one query: title, unread count, last message.
create or replace function public.my_chats()
returns table (
  id uuid,
  type public.chat_type,
  name text,
  title text,
  unread bigint,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    c.type,
    c.name,
    case c.type
      when 'direct' then coalesce(
        (select pr.full_name
           from public.chat_participants cp
           join public.profiles pr on pr.id = cp.user_id
          where cp.chat_id = c.id and cp.user_id <> auth.uid()
          limit 1),
        'Direct chat')
      when 'group' then coalesce(c.name, 'Group')
      else coalesce(c.name, 'Announcements')
    end as title,
    (select count(*)
       from public.chat_messages m
      where m.chat_id = c.id
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(p.last_read_at, c.created_at)) as unread,
    coalesce(nullif(btrim(lm.body), ''), lm.file_name) as last_message,
    lm.created_at as last_message_at,
    c.created_at
  from public.chats c
  left join public.chat_participants p on p.chat_id = c.id and p.user_id = auth.uid()
  left join lateral (
    select m.body, m.file_name, m.created_at
    from public.chat_messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where p.user_id is not null or c.type = 'announcement'
  order by coalesce(lm.created_at, c.created_at) desc
$$;

-- ---------------------------------------------------------------------------
-- Reporting. SECURITY INVOKER on purpose: RLS decides what each caller can see,
-- so managers get company-wide numbers and employees only their own.
-- Aggregating here (not in the app) avoids PostgREST's 1000-row response cap.
-- ---------------------------------------------------------------------------
create or replace function public.task_status_counts()
returns table (status public.task_status, n bigint)
language sql
stable
set search_path = public
as $$
  select t.status, count(*) from public.tasks t group by t.status
$$;

create or replace function public.report_summary(p_from timestamptz default null)
returns table (
  total bigint,
  completed bigint,
  pending bigint,
  overdue bigint,
  on_time bigint,
  avg_days numeric
)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where t.status <> 'cancelled'),
    count(*) filter (where t.status = 'completed' and (p_from is null or t.completed_at >= p_from)),
    count(*) filter (where t.status in ('todo', 'in_progress', 'blocked')),
    count(*) filter (where t.status in ('todo', 'in_progress', 'blocked') and t.due_date < current_date),
    count(*) filter (
      where t.status = 'completed'
        and (p_from is null or t.completed_at >= p_from)
        and (t.due_date is null or t.completed_at::date <= t.due_date)
    ),
    round(avg(extract(epoch from (t.completed_at - t.created_at)) / 86400.0) filter (
      where t.status = 'completed' and (p_from is null or t.completed_at >= p_from)
    )::numeric, 1)
  from public.tasks t
  where p_from is null or t.created_at >= p_from or t.completed_at >= p_from
$$;

create or replace function public.report_performance(p_from timestamptz default null)
returns table (
  user_id uuid,
  full_name text,
  department text,
  assigned bigint,
  completed bigint,
  on_time bigint,
  overdue bigint,
  avg_progress numeric
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.department,
    count(*),
    count(*) filter (where t.status = 'completed'),
    count(*) filter (where t.status = 'completed' and (t.due_date is null or t.completed_at::date <= t.due_date)),
    count(*) filter (where t.status in ('todo', 'in_progress', 'blocked') and t.due_date < current_date),
    round(avg(t.progress)::numeric, 0)
  from public.task_assignments ta
  join public.tasks t on t.id = ta.task_id
  join public.profiles p on p.id = ta.user_id
  where t.status <> 'cancelled'
    and (p_from is null or t.created_at >= p_from or t.completed_at >= p_from)
  group by p.id, p.full_name, p.department
  order by 5 desc, 4 desc, p.full_name
$$;

create or replace function public.report_weekly_trend(p_weeks integer default 8)
returns table (week_start date, created bigint, completed bigint)
language sql
stable
set search_path = public
as $$
  with weeks as (
    select generate_series(
      date_trunc('week', current_date)::date - ((greatest(least(p_weeks, 52), 1) - 1) * 7),
      date_trunc('week', current_date)::date,
      interval '7 days'
    )::date as week_start
  )
  select
    w.week_start,
    (select count(*) from public.tasks t
      where t.created_at >= w.week_start and t.created_at < w.week_start + 7),
    (select count(*) from public.tasks t
      where t.completed_at >= w.week_start and t.completed_at < w.week_start + 7)
  from weeks w
  order by w.week_start
$$;

revoke all on function public.task_status_counts() from public, anon;
revoke all on function public.report_summary(timestamptz) from public, anon;
revoke all on function public.report_performance(timestamptz) from public, anon;
revoke all on function public.report_weekly_trend(integer) from public, anon;
grant execute on function public.task_status_counts() to authenticated;
grant execute on function public.report_summary(timestamptz) to authenticated;
grant execute on function public.report_performance(timestamptz) to authenticated;
grant execute on function public.report_weekly_trend(integer) to authenticated;

revoke all on function public.open_direct_chat(uuid) from public, anon;
revoke all on function public.create_group_chat(text, uuid[]) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.my_chats() from public, anon;
grant execute on function public.open_direct_chat(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.my_chats() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_history enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;

-- Remove policies from earlier revisions of this script.
drop policy if exists users_update_self on public.users;
drop policy if exists users_insert_admin on public.users;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists th_insert on public.task_history;
drop policy if exists cp_insert on public.chat_participants;
drop policy if exists cp_update on public.chat_participants;

-- Roles: read-only for everyone signed in.
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);

-- Users: directory is readable; only admins update (guard trigger limits who can touch Super Admin).
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated using (true);

drop policy if exists users_update_admin on public.users;
create policy users_update_admin on public.users for update to authenticated
  using (public.has_role(array['super_admin', 'admin']))
  with check (public.has_role(array['super_admin', 'admin']));

-- Profiles: self, or an admin (only a Super Admin may edit another Super Admin).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (
    id = auth.uid()
    or (
      public.has_role(array['super_admin', 'admin'])
      and (public.has_role(array['super_admin']) or coalesce(public.user_role_name(id), '') <> 'super_admin')
    )
  )
  with check (
    id = auth.uid()
    or (
      public.has_role(array['super_admin', 'admin'])
      and (public.has_role(array['super_admin']) or coalesce(public.user_role_name(id), '') <> 'super_admin')
    )
  );

-- Employees
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated using (true);

drop policy if exists employees_mutate on public.employees;
create policy employees_mutate on public.employees for all to authenticated
  using (
    public.has_role(array['super_admin', 'admin'])
    and (public.has_role(array['super_admin']) or coalesce(public.user_role_name(user_id), '') <> 'super_admin')
  )
  with check (
    public.has_role(array['super_admin', 'admin'])
    and (public.has_role(array['super_admin']) or coalesce(public.user_role_name(user_id), '') <> 'super_admin')
  );

-- Tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.has_role(array['super_admin', 'admin', 'manager'])
    or created_by = auth.uid()
    or public.is_task_assignee(id)
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_role(array['super_admin', 'admin', 'manager']) and created_by = auth.uid());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    public.has_role(array['super_admin', 'admin', 'manager'])
    or public.is_task_assignee(id)
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_role(array['super_admin', 'admin']));

-- Assignments
drop policy if exists ta_select on public.task_assignments;
create policy ta_select on public.task_assignments for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_role(array['super_admin', 'admin', 'manager'])
    or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = auth.uid())
  );

drop policy if exists ta_insert on public.task_assignments;
create policy ta_insert on public.task_assignments for insert to authenticated
  with check (public.has_role(array['super_admin', 'admin', 'manager']));

drop policy if exists ta_delete on public.task_assignments;
create policy ta_delete on public.task_assignments for delete to authenticated
  using (public.has_role(array['super_admin', 'admin', 'manager']));

-- Comments
drop policy if exists tc_select on public.task_comments;
create policy tc_select on public.task_comments for select to authenticated
  using (
    public.has_role(array['super_admin', 'admin', 'manager'])
    or public.is_task_assignee(task_id)
    or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = auth.uid())
  );

drop policy if exists tc_insert on public.task_comments;
create policy tc_insert on public.task_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.has_role(array['super_admin', 'admin', 'manager'])
      or public.is_task_assignee(task_id)
    )
  );

-- History is written only by triggers.
drop policy if exists th_select on public.task_history;
create policy th_select on public.task_history for select to authenticated
  using (
    public.has_role(array['super_admin', 'admin', 'manager'])
    or public.is_task_assignee(task_id)
    or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = auth.uid())
  );

-- Chats: members read; membership and rooms are created through the RPCs above.
drop policy if exists chats_select on public.chats;
create policy chats_select on public.chats for select to authenticated
  using (type = 'announcement' or public.is_chat_member(id));

drop policy if exists chats_insert on public.chats;
create policy chats_insert on public.chats for insert to authenticated
  with check (
    created_by = auth.uid()
    and type = 'announcement'
    and public.has_role(array['super_admin', 'admin'])
  );

drop policy if exists cp_select on public.chat_participants;
create policy cp_select on public.chat_participants for select to authenticated
  using (user_id = auth.uid() or public.is_chat_member(chat_id));

drop policy if exists cm_select on public.chat_messages;
create policy cm_select on public.chat_messages for select to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists cm_insert on public.chat_messages;
create policy cm_insert on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_post_chat(chat_id));

-- Notifications: own rows only, and rows cannot be re-addressed.
drop policy if exists n_select on public.notifications;
create policy n_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists n_update on public.notifications;
create policy n_update on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists n_insert on public.notifications;
create policy n_insert on public.notifications for insert to authenticated
  with check (public.has_role(array['super_admin', 'admin']) or user_id = auth.uid());

-- Audit trail
drop policy if exists al_select on public.activity_logs;
create policy al_select on public.activity_logs for select to authenticated
  using (public.has_role(array['super_admin', 'admin', 'manager']) or actor_id = auth.uid());

drop policy if exists al_insert on public.activity_logs;
create policy al_insert on public.activity_logs for insert to authenticated
  with check (actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter table public.notifications replica identity full;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.chat_messages';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.notifications';
  exception when duplicate_object then null;
  end;
  -- Earlier revisions also published tasks; nothing subscribes to it.
  begin
    execute 'alter publication supabase_realtime drop table public.tasks';
  exception when undefined_object then null;
  end;
end $$;
