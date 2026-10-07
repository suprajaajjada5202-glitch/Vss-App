#!/usr/bin/env node
// Applies supabase/schema.sql and supabase/storage.sql to your Supabase project over a Postgres
// connection, then verifies the result. The password is read from .env.local and is never printed.
//
//   npm run db:status                        read-only: what is installed?
//   npm run db:setup                         apply schema + storage (safe to re-run)
//   npm run db:setup -- --promote you@co.com also make that existing Auth user a Super Admin
//   npm run db:setup -- --yes                skip the confirmation prompt
//
// Connection (put ONE of these in .env.local, not in chat or in git):
//   SUPABASE_DB_PASSWORD=...   uses db.<project-ref>.supabase.co:5432 (IPv6 only unless you bought the IPv4 add-on)
//   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
//                              (Dashboard -> Connect -> "Session pooler": works over IPv4)

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import pg from "pg";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const APP_TABLES = [
  "roles", "users", "profiles", "employees", "tasks", "task_assignments", "task_comments", "task_history",
  "chats", "chat_participants", "chat_messages", "notifications", "activity_logs",
];
const APP_FUNCTIONS = [
  "has_role", "current_role_name", "is_chat_member", "can_post_chat", "open_direct_chat", "create_group_chat",
  "mark_chat_read", "my_chats", "task_status_counts", "report_summary", "report_performance", "report_weekly_trend",
  "chat_id_from_path",
];

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------
const out = {
  ok: (m) => console.log(`  ✓ ${m}`),
  bad: (m) => console.log(`  ✗ ${m}`),
  info: (m) => console.log(m),
};

function fail(message, hint) {
  console.error(`\nError: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    const path = `${ROOT}${file}`;
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trimStart().startsWith("#")) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (env[m[1]] === undefined || env[m[1]] === "") env[m[1]] = value;
    }
  }
  return env;
}

function projectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

/** Build a pg config from SUPABASE_DB_URL or SUPABASE_DB_PASSWORD. Never logs the password. */
function connectionFrom(env) {
  let config;
  if (env.SUPABASE_DB_URL) {
    let url;
    try {
      url = new URL(env.SUPABASE_DB_URL);
    } catch {
      fail(
        "SUPABASE_DB_URL is not a valid URL.",
        "If the password contains characters like @ # / ? it must be percent-encoded, or use SUPABASE_DB_PASSWORD instead."
      );
    }
    config = {
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username || "postgres"),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres"),
    };
  } else if (env.SUPABASE_DB_PASSWORD) {
    const ref = projectRef(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (!ref) fail("Cannot derive the database host: NEXT_PUBLIC_SUPABASE_URL is not https://<ref>.supabase.co.");
    config = { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: env.SUPABASE_DB_PASSWORD, database: "postgres" };
  } else {
    fail(
      "No database credentials found.",
      [
        "Add ONE of these to .env.local (not to chat, not to git):",
        "  SUPABASE_DB_PASSWORD=<your database password>",
        "  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres",
        "Dashboard -> Connect shows the connection strings; Project Settings -> Database can reset a forgotten password.",
      ].join("\n")
    );
  }
  const hosted = /\.supabase\.(co|com)$/.test(config.host);
  if (hosted) {
    // Encrypted. Supabase uses its own CA; set SUPABASE_DB_SSL_CA to a downloaded cert file to verify it.
    config.ssl = env.SUPABASE_DB_SSL_CA ? { ca: readFileSync(env.SUPABASE_DB_SSL_CA, "utf8") } : { rejectUnauthorized: false };
  }
  return { config, hosted };
}

function explainConnectionError(error, config) {
  const code = error.code ?? "";
  if (["ENOTFOUND", "ENODATA", "ENETUNREACH", "EHOSTUNREACH", "EAFNOSUPPORT", "ETIMEDOUT"].includes(code)) {
    return [
      `Could not reach ${config.host}:${config.port} (${code}).`,
      /^db\..+\.supabase\.co$/.test(config.host)
        ? "Direct connections use IPv6 only unless the project has the IPv4 add-on, and your network may not support IPv6.\nUse the IPv4-friendly Session pooler instead: Dashboard -> Connect -> \"Session pooler\", and put that string in SUPABASE_DB_URL."
        : "Check the host, your network and any firewall.",
    ].join("\n");
  }
  if (code === "28P01" || /password authentication failed/i.test(error.message)) {
    return "The database rejected the password. Reset it under Project Settings -> Database if needed.\n(Pooler connections also need the user to be postgres.<project-ref>.)";
  }
  if (/Tenant or user not found/i.test(error.message)) {
    return "The pooler did not recognise the user/region. Copy the Session pooler string from Dashboard -> Connect exactly (user is postgres.<project-ref>).";
  }
  return error.message;
}

async function inspect(client) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const [{ who, version }] = await q("select current_user as who, current_setting('server_version') as version");
  const [markers] = await q(
    `select
       (select count(*) from pg_namespace where nspname in ('auth','storage'))::int as schemas,
       exists(select 1 from pg_roles where rolname = 'authenticated') as roles,
       exists(select 1 from pg_publication where pubname = 'supabase_realtime') as publication`
  );
  const tables = new Map(
    (await q(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r'`)).map((r) => [r.relname, r.relrowsecurity])
  );
  const functions = new Set((await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).map((r) => r.proname));
  return { who, version, markers, tables, functions, q };
}

async function verify(client, state) {
  const { q } = state;
  const problems = [];
  const check = (cond, label) => (cond ? out.ok(label) : (out.bad(label), problems.push(label)));

  const missingTables = APP_TABLES.filter((t) => !state.tables.has(t));
  check(!missingTables.length, missingTables.length ? `tables missing: ${missingTables.join(", ")}` : `${APP_TABLES.length} tables present`);
  const noRls = APP_TABLES.filter((t) => state.tables.has(t) && !state.tables.get(t));
  check(!noRls.length, noRls.length ? `row level security OFF on: ${noRls.join(", ")}` : "row level security enabled on every table");
  const missingFns = APP_FUNCTIONS.filter((f) => !state.functions.has(f));
  check(!missingFns.length, missingFns.length ? `functions missing: ${missingFns.join(", ")}` : `${APP_FUNCTIONS.length} functions present`);

  if (state.tables.has("roles")) {
    const [{ n }] = await q("select count(*)::int as n from public.roles");
    check(n === 4, `4 roles seeded (found ${n})`);
  }
  const [{ trig }] = await q(`select exists(select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created') as trig`);
  check(trig, "new sign-ups get staff rows (auth.users trigger)");
  const buckets = (await q("select id, public from storage.buckets where id in ('avatars','chat-files') order by id")).map((b) => `${b.id}${b.public ? " (public)" : " (private)"}`);
  check(buckets.length === 2, `storage buckets: ${buckets.join(", ") || "none"}`);
  const published = new Set((await q("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'")).map((r) => r.tablename));
  check(published.has("chat_messages") && published.has("notifications"), "realtime enabled for chat messages and notifications");

  if (state.tables.has("users")) {
    const [{ auth_users, app_users, admins }] = await q(
      `select (select count(*) from auth.users)::int as auth_users,
              (select count(*) from public.users)::int as app_users,
              (select count(*) from public.users u join public.roles r on r.id = u.role_id where r.name = 'super_admin')::int as admins`
    );
    check(auth_users === app_users, `every Auth user has a staff record (${app_users}/${auth_users})`);
    if (admins === 0) out.info(`  ! no Super Admin yet: add a user in Authentication -> Users, then run: npm run db:setup -- --promote <email>`);
    else out.ok(`${admins} Super Admin${admins === 1 ? "" : "s"}`);
  }
  return problems;
}

async function applyFile(client, name) {
  const sql = readFileSync(`${ROOT}supabase/${name}`, "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("commit");
    out.ok(`${name} applied`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const line = error.position ? sql.slice(0, Number(error.position)).split("\n").length : null;
    const details = [error.message, line ? `(${name}, around line ${line})` : `(${name})`, error.hint ? `hint: ${error.hint}` : ""].filter(Boolean).join(" ");
    fail(`${name} failed and was rolled back; nothing was changed.`, details);
  }
}

async function confirm(question) {
  if (has("--yes") || !process.stdin.isTTY) return has("--yes");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

// ---------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------
const EMAIL = /^[^\s'";\\]+@[^\s'";\\]+\.[^\s'";\\]+$/;
const promote = valueOf("--promote");
if (has("--promote") && !(promote && EMAIL.test(promote))) {
  fail(`--promote needs an email address (got "${promote ?? ""}").`, "Example: npm run db:setup -- --promote you@company.com");
}

const env = loadEnv();
const { config } = connectionFrom(env);
const client = new pg.Client({ ...config, connectionTimeoutMillis: 15000 });
client.on("error", () => {});

out.info(`\nVSS Pulse database ${has("--status") ? "status" : "setup"}`);
out.info(`  target: ${config.user}@${config.host}:${config.port}/${config.database}`);

try {
  await client.connect();
} catch (error) {
  fail(explainConnectionError(error, config));
}

let state = await inspect(client);
out.info(`  connected as ${state.who}, PostgreSQL ${state.version}\n`);

if (state.markers.schemas < 2 || !state.markers.roles || !state.markers.publication) {
  await client.end();
  fail(
    "This does not look like a Supabase database (auth/storage schemas, the authenticated role or the realtime publication are missing).",
    "Check that the connection string points at your Supabase project."
  );
}

const present = APP_TABLES.filter((t) => state.tables.has(t));
const installed = state.tables.has("roles");

if (promote && !has("--status")) {
  const { rows } = await client.query("select 1 from auth.users where lower(email) = lower($1)", [promote]);
  if (!rows.length) {
    await client.end();
    fail(
      `No Auth user with email ${promote}. Nothing was changed.`,
      "Create them first: Dashboard -> Authentication -> Users -> Add user (tick Auto Confirm User), then re-run with --promote."
    );
  }
}

if (has("--status")) {
  out.info(installed ? "Installed. Checking:" : present.length ? "Not installed (some table names already exist from something else)." : "Not installed yet. Run: npm run db:setup");
  if (installed) {
    const problems = await verify(client, state);
    out.info(problems.length ? `\n${problems.length} problem(s). Run: npm run db:setup` : "\nAll good.");
  }
  await client.end();
  process.exit(0);
}

if (present.length && !installed && !has("--force")) {
  await client.end();
  fail(
    `Tables with this app's names already exist in "public" (${present.join(", ")}) but its "roles" table does not, so they probably belong to something else.`,
    "Nothing was changed. If you are sure, re-run with --force."
  );
}

out.info(installed ? "VSS Pulse is already installed here; re-applying is safe and idempotent." : "Fresh install: this creates the VSS Pulse tables, functions, policies and storage buckets.");
if (!(await confirm(`Apply to ${config.host}/${config.database}?`))) {
  await client.end();
  fail("Not confirmed; nothing was changed. Re-run with --yes to skip the prompt.");
}

out.info("");
await applyFile(client, "schema.sql");
await applyFile(client, "storage.sql");
await client.query("notify pgrst, 'reload schema'");

if (promote) {
  // Same statements as supabase/seed.sql, with the placeholder replaced by the validated address.
  const seed = readFileSync(`${ROOT}supabase/seed.sql`, "utf8").replace("admin@your-company.com", promote);
  await client.query("begin");
  try {
    await client.query(seed);
    await client.query("commit");
    out.ok(`${promote} is now a Super Admin`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    fail(`Promotion failed: ${error.message}`);
  }
}

state = await inspect(client);
out.info("\nVerifying:");
const problems = await verify(client, state);
await client.end();

if (problems.length) fail(`${problems.length} check(s) failed. See above.`);
out.info(
  [
    "\nDatabase is ready. Remaining dashboard steps:",
    "  1. Authentication -> Sign In / Providers: turn OFF \"Allow new users to sign up\".",
    "  2. Authentication -> URL Configuration: Site URL = your app URL; add <app url>/auth/callback to redirect URLs.",
    promote ? "  3. Sign in at your app with that account." : "  3. Authentication -> Users -> Add user, then: npm run db:setup -- --promote <email>",
    "",
  ].join("\n")
);
