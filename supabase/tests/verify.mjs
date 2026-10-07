// Behavioural tests for supabase/schema.sql + storage.sql, run on an in-process Postgres (PGlite).
// They exercise the RLS policies, triggers and RPCs the way an authenticated Supabase user would.
// Run: npm run test:sql
import { fileURLToPath } from "node:url";
import { boot, addUser, as, check, summary, show } from "./lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const db = await boot([`${ROOT}/schema.sql`, `${ROOT}/storage.sql`]);
console.log("schema.sql + storage.sql applied");

// Idempotency: running the schema a second time must not error.
{
  const fs = await import("node:fs");
  for (const file of ["schema.sql", "storage.sql"]) {
    try {
      await db.exec(fs.readFileSync(`${ROOT}/${file}`, "utf8"));
      check(`${file} is re-runnable`, true);
    } catch (e) {
      check(`${file} is re-runnable`, false, e.message);
    }
  }
}

const alice = await addUser(db, "alice@x.test", "Alice", "employee");
const bob = await addUser(db, "bob@x.test", "Bob", "employee");
const carol = await addUser(db, "carol@x.test", "Carol", "manager");
const dave = await addUser(db, "dave@x.test", "Dave", "admin");
const erin = await addUser(db, "erin@x.test", "Erin", "super_admin");
const roleName = async (id) =>
  (await db.query(`select r.name from public.users u join public.roles r on r.id=u.role_id where u.id=$1`, [id])).rows[0]?.name;

console.log("\n== bootstrap trigger");
{
  const r = await db.query(`select employee_code from public.employees order by employee_code`);
  check("employee codes are sequential & unique", new Set(r.rows.map((x) => x.employee_code)).size === 5 && r.rows[0].employee_code === "VSS-1001", JSON.stringify(r.rows));
  const p = await db.query(`select count(*)::int n from public.chat_participants where chat_id='00000000-0000-0000-0000-000000000001'`);
  check("every new user joins announcements", p.rows[0].n === 5);
}

console.log("\n== privilege escalation");
{
  let r = await as(db, bob, `update public.users set role_id=(select id from public.roles where name='super_admin') where id=$1`, [bob]);
  check("employee cannot self-promote (RLS or guard)", (await roleName(bob)) === "employee", show(r));
  r = await as(db, carol, `update public.users set role_id=(select id from public.roles where name='admin') where id=$1`, [carol]);
  check("manager cannot self-promote", (await roleName(carol)) === "manager", show(r));
  r = await as(db, dave, `update public.users set role_id=(select id from public.roles where name='super_admin') where id=$1`, [alice]);
  check("admin cannot mint a super_admin", (await roleName(alice)) === "employee", show(r));
  r = await as(db, dave, `update public.users set role_id=(select id from public.roles where name='employee') where id=$1`, [erin]);
  check("admin cannot demote a super_admin", (await roleName(erin)) === "super_admin", show(r));
  r = await as(db, dave, `update public.users set role_id=(select id from public.roles where name='manager') where id=$1 returning id`, [alice]);
  check("admin CAN promote employee -> manager", !r.error && (await roleName(alice)) === "manager", show(r));
  await db.query(`update public.users set role_id=(select id from public.roles where name='employee') where id=$1`, [alice]);
  r = await as(db, erin, `update public.users set role_id=(select id from public.roles where name='admin') where id=$1 returning id`, [alice]);
  check("super_admin CAN promote to admin", !r.error && (await roleName(alice)) === "admin", show(r));
  await db.query(`update public.users set role_id=(select id from public.roles where name='employee') where id=$1`, [alice]);
  const log = await db.query(`select action, metadata from public.activity_logs where action='user_role_changed' order by created_at`);
  check("role changes are written to the audit trail by the DB", log.rows.length >= 2, JSON.stringify(log.rows));
  r = await as(db, bob, `update public.profiles set full_name='Hacked' where id=$1`, [erin]);
  check("employee cannot edit someone else's profile", (await db.query(`select full_name from public.profiles where id=$1`, [erin])).rows[0].full_name === "Erin", show(r));
  r = await as(db, dave, `update public.profiles set full_name='Hacked' where id=$1`, [erin]);
  check("admin cannot edit a super_admin's profile", (await db.query(`select full_name from public.profiles where id=$1`, [erin])).rows[0].full_name === "Erin", show(r));
  r = await as(db, bob, `update public.profiles set full_name='Bobby' where id=$1 returning id`, [bob]);
  check("employee can edit own profile", !r.error && r.rows?.length === 1, show(r));
  r = await as(db, bob, `update public.profiles set avatar_url='javascript:alert(1)' where id=$1`, [bob]);
  check("avatar_url must be http(s) (blocks javascript:)", !!r.error, show(r));
}

console.log("\n== tasks");
let task;
{
  let r = await as(db, carol, `insert into public.tasks (title, created_by, priority) values ('Ship it', $1, 'high') returning id`, [carol]);
  check("manager can create a task", !r.error, show(r));
  task = r.rows?.[0]?.id;
  r = await as(db, bob, `insert into public.tasks (title, created_by) values ('nope', $1) returning id`, [bob]);
  check("employee cannot create a task", !!r.error, show(r));
  r = await as(db, carol, `insert into public.tasks (title, created_by) values ('forged', $1) returning id`, [bob]);
  check("manager cannot create a task as someone else", !!r.error, show(r));

  r = await as(db, carol, `insert into public.task_assignments (task_id, user_id, assigned_by) values ($1,$2,$3),($1,$4,$3)`, [task, bob, carol, alice]);
  check("manager can assign several people", !r.error, show(r));

  const n = await db.query(`select user_id, type from public.notifications where type='task_assigned'`);
  check("each assignee is notified", n.rows.length === 2, JSON.stringify(n.rows));

  r = await as(db, bob, `update public.tasks set status='in_progress', progress=40 where id=$1 returning status`, [task]);
  check("assignee can update status/progress", !r.error && r.rows?.[0]?.status === "in_progress", show(r));
  r = await as(db, bob, `update public.tasks set title='Pwned' where id=$1`, [task]);
  check("assignee cannot rewrite the title", !!r.error || (await db.query(`select title from public.tasks where id=$1`, [task])).rows[0].title === "Ship it", show(r));
  r = await as(db, bob, `update public.tasks set due_date='2030-01-01', priority='low' where id=$1`, [task]);
  check("assignee cannot change due date / priority", !!r.error, show(r));
  r = await as(db, bob, `update public.tasks set created_by=$2 where id=$1`, [task, bob]);
  check("created_by is immutable", !!r.error, show(r));

  const outsider = await addUser(db, "zed@x.test", "Zed", "employee");
  r = await as(db, outsider, `select id from public.tasks where id=$1`, [task]);
  check("unrelated employee cannot see the task", r.rows?.length === 0, show(r));
  r = await as(db, outsider, `update public.tasks set status='cancelled' where id=$1 returning id`, [task]);
  check("unrelated employee cannot update the task", r.rows?.length === 0, show(r));

  // Status change notifies creator + other assignee, not the actor.
  await db.query(`delete from public.notifications`);
  r = await as(db, bob, `update public.tasks set status='completed' where id=$1`, [task]);
  const t = (await db.query(`select status, progress, completed_at from public.tasks where id=$1`, [task])).rows[0];
  check("completing sets progress=100 and completed_at", t.status === "completed" && t.progress === 100 && t.completed_at, JSON.stringify(t));
  const notified = (await db.query(`select user_id from public.notifications where type='task_status'`)).rows.map((x) => x.user_id).sort();
  check("status change notifies creator + co-assignee, not the actor",
    JSON.stringify(notified) === JSON.stringify([alice, carol].sort()), JSON.stringify(notified));

  r = await as(db, carol, `update public.tasks set status='in_progress' where id=$1`, [task]);
  check("reopening clears completed_at", (await db.query(`select completed_at from public.tasks where id=$1`, [task])).rows[0].completed_at === null);

  r = await as(db, carol, `update public.tasks set priority='critical', due_date='2030-02-02' where id=$1 returning id`, [task]);
  check("manager can edit task details", !r.error && r.rows?.length === 1, show(r));

  const h = (await db.query(`select action from public.task_history where task_id=$1 order by created_at, id`, [task])).rows.map((x) => x.action);
  console.log("    history:", h.join(", "));
  check("history records created/assigned/status/updated", ["created", "assigned", "status_changed", "updated"].every((a) => h.includes(a)), h.join(","));
  r = await as(db, bob, `insert into public.task_history (task_id, action) values ($1,'forged')`, [task]);
  check("clients cannot forge task history", !!r.error, show(r));
  r = await as(db, bob, `select count(*)::int n from public.task_history where task_id=$1`, [task]);
  check("assignee can read history", r.rows?.[0]?.n >= 4, show(r));

  r = await as(db, bob, `insert into public.task_comments (task_id, user_id, body) values ($1,$2,'on it')`, [task, bob]);
  check("assignee can comment", !r.error, show(r));
  r = await as(db, outsider, `insert into public.task_comments (task_id, user_id, body) values ($1,$2,'hi')`, [task, outsider]);
  check("outsider cannot comment", !!r.error, show(r));

  r = await as(db, carol, `delete from public.tasks where id=$1 returning id`, [task]);
  check("manager cannot delete tasks", !r.rows?.length, show(r));
  r = await as(db, dave, `update public.task_assignments set user_id=user_id where task_id=$1`, [task]);
  // unassign + task cascade delete must not trip the history FK
  r = await as(db, carol, `delete from public.task_assignments where task_id=$1 and user_id=$2 returning id`, [task, alice]);
  check("manager can unassign (history ok)", !r.error && r.rows?.length === 1, show(r));
  r = await as(db, dave, `delete from public.tasks where id=$1 returning id`, [task]);
  check("admin can delete a task with assignments/history (no FK trip)", !r.error && r.rows?.length === 1, show(r));
}

console.log("\n== chat");
{
  let r = await as(db, bob, `select public.open_direct_chat($1) as id`, [alice]);
  check("employee can open a direct chat", !r.error && r.rows?.[0]?.id, show(r));
  const dm = r.rows?.[0]?.id;
  r = await as(db, alice, `select public.open_direct_chat($1) as id`, [bob]);
  check("opening from the other side returns the same chat", r.rows?.[0]?.id === dm, show(r));
  r = await as(db, bob, `select public.open_direct_chat($1) as id`, [bob]);
  check("cannot DM yourself", !!r.error, show(r));
  r = await as(db, bob, `select public.open_direct_chat(gen_random_uuid()) as id`);
  check("cannot DM a non-existent user", !!r.error, show(r));
  r = await db.query(`select count(*)::int n from public.chat_participants where chat_id=$1`, [dm]);
  check("direct chat has exactly 2 participants", r.rows[0].n === 2);

  r = await as(db, bob, `insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'hello alice')`, [dm, bob]);
  check("member can send", !r.error, show(r));
  r = await as(db, bob, `insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'   ')`, [dm, bob]);
  check("blank message rejected", !!r.error, show(r));
  r = await as(db, bob, `insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'spoof')`, [dm, alice]);
  check("cannot send as someone else", !!r.error, show(r));

  r = await as(db, carol, `select body from public.chat_messages where chat_id=$1`, [dm]);
  check("outsider cannot read a private chat", r.rows?.length === 0, show(r));
  r = await as(db, carol, `insert into public.chat_participants (chat_id, user_id) values ($1,$2)`, [dm, carol]);
  check("outsider cannot join a private chat", !!r.error, show(r));
  r = await as(db, carol, `update public.chat_participants set chat_id=$1 where user_id=$2`, [dm, carol]);
  check("outsider cannot hop into a chat via UPDATE", !r.rows?.length && (await db.query(`select 1 from public.chat_participants where chat_id=$1 and user_id=$2`, [dm, carol])).rows.length === 0, show(r));
  r = await as(db, carol, `insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'intrude')`, [dm, carol]);
  check("outsider cannot post into a private chat", !!r.error, show(r));
  r = await as(db, carol, `insert into public.chats (type, created_by) values ('direct', $1)`, [carol]);
  check("clients cannot insert chat rows directly", !!r.error, show(r));

  r = await as(db, alice, `select unread from public.my_chats() where id=$1`, [dm]);
  check("my_chats reports 1 unread for the recipient", Number(r.rows?.[0]?.unread) === 1, show(r));
  r = await as(db, bob, `select unread, title from public.my_chats() where id=$1`, [dm]);
  check("sender sees 0 unread and the other person's name as title", Number(r.rows?.[0]?.unread) === 0 && r.rows?.[0]?.title === "Alice", show(r));
  r = await as(db, alice, `select public.mark_chat_read($1)`, [dm]);
  r = await as(db, alice, `select unread from public.my_chats() where id=$1`, [dm]);
  check("mark_chat_read clears unread", Number(r.rows?.[0]?.unread) === 0, show(r));
  const nn = await db.query(`select read_at from public.notifications where user_id=$1 and type='chat_message'`, [alice]);
  check("mark_chat_read also clears the chat notification", nn.rows.length === 1 && nn.rows[0].read_at, JSON.stringify(nn.rows));

  // notification coalescing
  await db.query(`insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'one'),($1,$2,'two'),($1,$2,'three')`, [dm, bob]);
  const coalesced = await db.query(`select count(*)::int n from public.notifications where user_id=$1 and type='chat_message' and read_at is null`, [alice]);
  check("burst of messages yields a single unread notification", coalesced.rows[0].n === 1, JSON.stringify(coalesced.rows));

  r = await as(db, carol, `select public.create_group_chat('Platform team', array[$1,$2]::uuid[]) as id`, [alice, bob]);
  check("manager can create a group", !r.error, show(r));
  const grp = r.rows?.[0]?.id;
  r = await db.query(`select count(*)::int n from public.chat_participants where chat_id=$1`, [grp]);
  check("group has creator + members", r.rows[0].n === 3, JSON.stringify(r.rows));
  r = await as(db, bob, `select title from public.my_chats() where id=$1`, [grp]);
  check("group members see the group", r.rows?.[0]?.title === "Platform team", show(r));
  r = await as(db, carol, `select public.create_group_chat('   ', array[]::uuid[]) as id`);
  check("empty group name rejected", !!r.error, show(r));

  // announcements
  const ann = "00000000-0000-0000-0000-000000000001";
  r = await as(db, bob, `insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'all hands')`, [ann, bob]);
  check("employee cannot post announcements", !!r.error, show(r));
  r = await as(db, dave, `insert into public.chat_messages (chat_id, sender_id, body) values ($1,$2,'All hands at 10')`, [ann, dave]);
  check("admin can post announcements", !r.error, show(r));
  r = await as(db, bob, `select body from public.chat_messages where chat_id=$1`, [ann]);
  check("everyone can read announcements", r.rows?.length === 1, show(r));
  const an = await db.query(`select count(*)::int n from public.notifications where type='announcement'`);
  check("announcement notifies everyone but the sender", an.rows[0].n === 5, JSON.stringify(an.rows));
  r = await as(db, bob, `select unread from public.my_chats() where id=$1`, [ann]);
  check("announcement shows as unread", Number(r.rows?.[0]?.unread) === 1, show(r));
  r = await as(db, bob, `select public.mark_chat_read($1)`, [ann]);
  r = await as(db, bob, `select unread from public.my_chats() where id=$1`, [ann]);
  check("announcement can be marked read", Number(r.rows?.[0]?.unread) === 0, show(r));
}

console.log("\n== notifications & audit");
{
  let r = await as(db, bob, `insert into public.notifications (user_id, type, title) values ($1,'system','phish')`, [alice]);
  check("employee cannot inject a notification into someone else's inbox", !!r.error, show(r));
  const nid = (await db.query(`select id from public.notifications where user_id=$1 limit 1`, [alice])).rows[0].id;
  r = await as(db, alice, `update public.notifications set user_id=$2 where id=$1`, [nid, bob]);
  check("cannot re-address own notification", !!r.error, show(r));
  r = await as(db, alice, `update public.notifications set read_at=now() where id=$1 returning id`, [nid]);
  check("can mark own notification read", r.rows?.length === 1, show(r));
  r = await as(db, bob, `update public.notifications set read_at=now() where id=$1 returning id`, [nid]);
  check("cannot touch someone else's notification", !r.rows?.length, show(r));

  r = await as(db, bob, `insert into public.activity_logs (actor_id, action, entity_type) values ($1,'x','y')`, [alice]);
  check("cannot log an action as someone else", !!r.error, show(r));
  r = await as(db, bob, `insert into public.activity_logs (actor_id, action, entity_type) values ($1,'profile_updated','profile')`, [bob]);
  check("can log own action", !r.error, show(r));
  r = await as(db, bob, `select count(*)::int n from public.activity_logs where actor_id <> $1`, [bob]);
  check("employee sees only own audit rows", r.rows?.[0]?.n === 0, show(r));
  r = await as(db, carol, `select count(*)::int n from public.activity_logs`);
  check("manager sees the full audit trail", r.rows?.[0]?.n >= 3, show(r));
}

console.log("\n== employee lifecycle");
{
  const gone = await addUser(db, "gone@x.test", "Gone", "manager");
  const t2 = (await db.query(`insert into public.tasks (title, created_by) values ('Orphan me', $1) returning id`, [gone])).rows[0].id;
  await db.query(`insert into public.task_assignments (task_id, user_id, assigned_by) values ($1,$2,$3)`, [t2, bob, gone]);
  await db.query(`insert into public.activity_logs (actor_id, action, entity_type) values ($1,'x','y')`, [gone]);
  let err = null;
  try {
    await db.query(`delete from auth.users where id=$1`, [gone]);
  } catch (e) {
    err = e.message;
  }
  check("deleting a user who created tasks / assigned work succeeds", !err, err);
  const t = (await db.query(`select created_by from public.tasks where id=$1`, [t2])).rows[0];
  check("their tasks survive with created_by = null", t && t.created_by === null, JSON.stringify(t));
  check("their profile/users rows are gone", (await db.query(`select 1 from public.profiles where id=$1`, [gone])).rows.length === 0);
}

console.log("\n== storage policies");
{
  const dm = (await db.query(`select id from public.chats where type='direct' limit 1`)).rows[0].id;
  const grp = (await db.query(`select id from public.chats where type='group' limit 1`)).rows[0].id;
  const ann = "00000000-0000-0000-0000-000000000001";
  const ins = (uid, bucket, name) =>
    as(db, uid, `insert into storage.objects (bucket_id, name, owner) values ($1,$2,$3) returning name`, [bucket, name, uid]);
  const sel = (uid, bucket, name) =>
    as(db, uid, `select name from storage.objects where bucket_id=$1 and name=$2`, [bucket, name]);

  let r = await ins(bob, "chat-files", `${dm}/${crypto.randomUUID()}-spec.pdf`);
  check("member can upload to their chat folder", !r.error, show(r));
  const dmFile = r.rows?.[0]?.name;
  r = await ins(carol, "chat-files", `${dm}/${crypto.randomUUID()}-evil.pdf`);
  check("non-member cannot upload into someone else's chat folder", !!r.error, show(r));
  r = await ins(bob, "chat-files", `${bob}/${crypto.randomUUID()}-loose.pdf`);
  check("uploads outside a chat folder are rejected", !!r.error, show(r));
  r = await ins(bob, "chat-files", `not-a-uuid/${crypto.randomUUID()}.pdf`);
  check("malformed folder name is rejected (no cast error leak)", !!r.error, show(r));
  r = await sel(alice, "chat-files", dmFile);
  check("other member can read the file", r.rows?.length === 1, show(r));
  r = await sel(carol, "chat-files", dmFile);
  check("non-member cannot read the file", r.rows?.length === 0, show(r));
  r = await ins(bob, "chat-files", `${ann}/${crypto.randomUUID()}-memo.pdf`);
  check("employee cannot upload into announcements", !!r.error, show(r));
  r = await ins(dave, "chat-files", `${ann}/${crypto.randomUUID()}-memo.pdf`);
  check("admin can upload into announcements", !r.error, show(r));
  r = await ins(carol, "chat-files", `${grp}/${crypto.randomUUID()}-plan.png`);
  check("group member can upload to the group", !r.error, show(r));

  r = await ins(bob, "avatars", `${bob}/me.png`);
  check("user can upload own avatar", !r.error, show(r));
  r = await ins(bob, "avatars", `${alice}/me.png`);
  check("user cannot write into someone else's avatar folder", !!r.error, show(r));
  r = await as(db, bob, `update storage.objects set name=$2 where bucket_id='avatars' and name=$1 returning name`, [`${bob}/me.png`, `${alice}/me.png`]);
  check("avatar UPDATE cannot move an object into another user's folder", !!r.error || !r.rows?.length, show(r));
  r = await as(db, bob, `delete from storage.objects where bucket_id='avatars' and name=$1 returning name`, [`${bob}/me.png`]);
  check("user can delete own avatar", r.rows?.length === 1, show(r));
  const b = (await db.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`)).rows;
  console.log("    buckets:", JSON.stringify(b));
  check("buckets have size limits", b.every((x) => Number(x.file_size_limit) > 0));
  check("chat-files bucket is private, avatars public", b.find((x) => x.id === "chat-files")?.public === false && b.find((x) => x.id === "avatars")?.public === true);
}

console.log("\n== reports (RLS-scoped aggregates)");
{
  const rep = await addUser(db, "rep@x.test", "Rep", "manager");
  const w1 = await addUser(db, "w1@x.test", "Worker One", "employee");
  const w2 = await addUser(db, "w2@x.test", "Worker Two", "employee");
  await db.query(`update public.profiles set department='Platform' where id in ($1,$2)`, [w1, w2]);
  const mk = async (title, status, due, assignee) => {
    const id = (await db.query(`insert into public.tasks (title, created_by, due_date) values ($1,$2,$3) returning id`, [title, rep, due])).rows[0].id;
    await db.query(`insert into public.task_assignments (task_id, user_id, assigned_by) values ($1,$2,$3)`, [id, assignee, rep]);
    if (status !== "todo") await db.query(`update public.tasks set status=$2 where id=$1`, [id, status]);
    return id;
  };
  await mk("done on time", "completed", "2999-01-01", w1);
  await mk("done late", "completed", "2000-01-01", w1);
  await mk("still open overdue", "in_progress", "2000-01-01", w1);
  await mk("w2 open", "todo", null, w2);

  let r = await as(db, rep, `select * from public.report_summary(null)`);
  const s = r.rows?.[0];
  console.log("    summary:", JSON.stringify(s, (k, v) => (typeof v === "bigint" ? Number(v) : v)));
  check("summary counts completed / pending / overdue / on-time", Number(s?.completed) >= 2 && Number(s?.overdue) >= 1 && Number(s?.on_time) >= 1, show(r));

  r = await as(db, rep, `select full_name, assigned, completed, on_time, overdue from public.report_performance(null) where full_name='Worker One'`);
  const p = r.rows?.[0];
  check("performance row: 3 assigned, 2 done, 1 on time, 1 overdue",
    p && Number(p.assigned) === 3 && Number(p.completed) === 2 && Number(p.on_time) === 1 && Number(p.overdue) === 1, show(r));

  r = await as(db, w2, `select full_name from public.report_performance(null)`);
  check("employee only sees their own row in performance report", r.rows?.length === 1 && r.rows[0].full_name === "Worker Two", show(r));
  r = await as(db, w2, `select total from public.report_summary(null)`);
  check("employee summary is scoped to their own tasks", Number(r.rows?.[0]?.total) === 1, show(r));

  r = await as(db, rep, `select * from public.report_weekly_trend(8)`);
  check("weekly trend returns 8 weeks incl. this week's completions",
    r.rows?.length === 8 && Number(r.rows[7].completed) >= 2, show(r));
  r = await as(db, rep, `select status, n from public.task_status_counts() order by status`);
  check("status counts grouped", r.rows?.length >= 2, show(r));
  r = await as(db, rep, `select * from public.report_summary(now() + interval '1 day')`);
  check("range filter excludes everything in the future", Number(r.rows?.[0]?.completed) === 0, show(r));
}

console.log("\n== anon role");
{
  await db.exec(`set role anon;`);
  let blocked = 0;
  for (const q of [`select * from public.users`, `select * from public.tasks`, `select * from public.chat_messages`, `select * from public.notifications`]) {
    try { const x = await db.query(q); if (x.rows.length === 0) blocked++; } catch { blocked++; }
  }
  for (const q of [`select public.open_direct_chat(gen_random_uuid())`, `select public.my_chats()`, `select * from public.report_summary(null)`]) {
    try { await db.query(q); } catch { blocked++; }
  }
  await db.exec(`reset role;`);
  check("anon sees no rows and cannot call chat RPCs", blocked === 7, `blocked=${blocked}/7`);
}

process.exit(summary() ? 1 : 0);
