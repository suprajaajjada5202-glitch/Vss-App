// Minimal Supabase emulation on top of PGlite (auth.uid(), anon/authenticated roles, storage stubs)
// so supabase/*.sql can be executed and RLS exercised without a Supabase project.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create publication supabase_realtime;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- storage stubs (only what supabase/storage.sql touches)
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;
`;

export async function boot(files, { stripExtensions = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUBS);
  for (const f of files) {
    let sql = readFileSync(f, "utf8");
    if (stripExtensions) sql = sql.replace(/create extension[^;]*;/gi, "");
    await db.exec(sql);
  }
  return db;
}

export async function addUser(db, email, name, role = "employee") {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, name]
  );
  const id = rows[0].id;
  await db.query(
    `update public.users set role_id = (select id from public.roles where name = $2) where id = $1`,
    [id, role]
  );
  return id;
}

// Run `fn` as an authenticated end user (RLS applies). Returns {rows} or {error}.
export async function as(db, uid, sql, params = []) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);`
  );
  try {
    const res = await db.query(sql, params);
    return { rows: res.rows, count: res.affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

let passed = 0;
let failed = 0;
export function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
}
export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}
export const show = (r) => (r.error ? `error: ${r.error}` : `ok rows=${JSON.stringify(r.rows)}`);
