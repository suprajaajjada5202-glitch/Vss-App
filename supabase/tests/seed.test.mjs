// seed.sql: promotes an existing user, backfills app rows, and is re-runnable.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { boot, check, summary } from "./lib.mjs";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const db = await boot([`${ROOT}/schema.sql`, `${ROOT}/storage.sql`]);
const seed = readFileSync(`${ROOT}/seed.sql`, "utf8");

// A user created in Supabase Auth BEFORE the schema was applied: no app rows.
const id = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('boss@acme.test', '{"full_name":"Big Boss"}') returning id`)).rows[0].id;
await db.exec(`delete from public.chat_participants; delete from public.employees; delete from public.profiles; delete from public.users;`);

let err = null;
try { await db.exec(seed); } catch (e) { err = e.message; }
check("seed.sql refuses an email that does not exist", /No user with email/.test(err ?? ""), err);

await db.exec(seed.replace("admin@your-company.com", "BOSS@acme.test")); // also case-insensitive
const u = (await db.query(`select r.name role from public.users u join public.roles r on r.id=u.role_id where u.id=$1`, [id])).rows[0];
check("promotes the user (case-insensitive) to super_admin", u?.role === "super_admin", JSON.stringify(u));
check("backfills profile + employee + announcements membership",
  (await db.query(`select 1 from public.profiles where id=$1 and full_name='Big Boss'`, [id])).rows.length === 1 &&
  (await db.query(`select 1 from public.employees where user_id=$1`, [id])).rows.length === 1 &&
  (await db.query(`select 1 from public.chat_participants where user_id=$1`, [id])).rows.length === 1);
await db.exec(seed.replace("admin@your-company.com", "boss@acme.test"));
check("seed.sql is re-runnable", (await db.query(`select count(*)::int n from public.employees`)).rows[0].n === 1);
process.exit(summary() ? 1 : 0);
