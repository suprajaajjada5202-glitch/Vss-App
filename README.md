# VSS Pulse — Employee Management

Employee management for a software company: directory, role-based access, tasks with history and comments, real-time team chat, notifications, reports and an audit trail.

Built with **Next.js 15** (App Router, Server Actions), **Supabase** (Auth, Postgres + Row Level Security, Realtime, Storage), **Tailwind CSS v4** and **Zustand**.

## Features

| Area | What you get |
| --- | --- |
| Auth | Email + password sign-in, forgot / reset password, change password, sign-out, session refresh in middleware, deactivated users locked out |
| Roles | Super Admin, Admin, Manager, Employee — enforced in the database (RLS), not just the UI |
| Dashboard | Total employees, total / pending / completed tasks, overdue count, status chart, 8-week trend, notifications, my open tasks, recent activity |
| Employees | Directory with search, department / role / status filters and pagination; add, edit, delete, view; temporary password shown once |
| Profile | Edit contact details, upload a photo, change password, read-only employment info |
| Tasks | Create, edit, assign several people, priority, due date, status, progress, comments, readable history log, search / filters / pagination |
| Chat | Direct messages, groups, company announcement channel, unread counts, "seen" in DMs, file sharing, search across rooms, realtime delivery |
| Notifications | New task, status change, chat message, profile update, announcements — in-app (live toasts) and email (optional) |
| Reports | Employee performance, completed-task report with on-time rate, team productivity by department, weekly trend, CSV export |
| Audit | Activity log; role and status changes are recorded by a database trigger |
| UI | Responsive (phone → desktop), dark / light mode, loading and error states, form validation |

## Roles

| | Employee | Manager | Admin | Super Admin |
| --- | :-: | :-: | :-: | :-: |
| View directory, edit own profile | ✓ | ✓ | ✓ | ✓ |
| See assigned tasks; update status / progress; comment | ✓ | ✓ | ✓ | ✓ |
| Chat (DMs, groups) | ✓ | ✓ | ✓ | ✓ |
| Create / edit / assign tasks (sees all tasks) | | ✓ | ✓ | ✓ |
| Company-wide reports, CSV export, full activity log | | ✓ | ✓ | ✓ |
| Add / edit / delete employees, set roles | | | ✓ | ✓ |
| Delete tasks, post announcements | | | ✓ | ✓ |
| Create, edit or delete Super Admins | | | | ✓ |

Employees see only their own numbers in Reports and their own entries in the Activity log.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Create the tables** — either:
   - **One command (recommended):** add your database password to `.env.local` as `SUPABASE_DB_PASSWORD=...` (Project Settings → Database), then run `npm run db:setup`. It applies `supabase/schema.sql` and `supabase/storage.sql` in a transaction (all or nothing), re-runs safely, refuses to touch a database that already has unrelated tables with these names, and ends with a verification checklist. `npm run db:status` re-checks at any time.
     If it says the host is unreachable: direct connections are IPv6-only; use Dashboard → Connect → **Session pooler** and put that string in `SUPABASE_DB_URL` instead.
   - **Or by hand:** in the dashboard SQL editor run, in order, `supabase/schema.sql` then `supabase/storage.sql` (both are safe to re-run).
3. **Authentication → Sign In / Providers** — turn **off "Allow new users to sign up"**. Accounts are created by admins only; leaving sign-ups on lets anyone with your public anon key register.
4. **Authentication → URL Configuration**
   - Site URL: your app URL (`http://localhost:3000` locally)
   - Redirect URLs: `<app url>/auth/callback`
5. **Authentication → Users → Add user** — create yourself (tick *Auto Confirm User*).
6. Make that user a Super Admin: `npm run db:setup -- --promote you@company.com`, or edit the email in `supabase/seed.sql` and run it in the SQL editor. (Either also backfills staff rows for anyone created before step 2.)

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. **Server only.** Used to create and delete logins. |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app, used in email links |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional. Without a key emails are skipped (and logged); everything else works. |
| `SUPABASE_DB_PASSWORD` or `SUPABASE_DB_URL` | Optional, only for `npm run db:setup`. Keep it in `.env.local`. |

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Until real keys are present every route redirects to `/setup`, which lists these steps. With keys but no tables, `/setup` shows what is left to do (and whether public sign-ups are still on); once the database is ready it redirects to the sign-in page. Admins also see a warning banner in the app if public sign-ups are enabled.

### Adding people

**Employees → Add employee** creates the login and the staff record. A temporary password is generated and shown **once**; if email is configured it is also mailed. The person sees a banner until they choose their own password under **My profile**.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:setup` / `db:status` | Apply / verify the database schema over a Postgres connection (see Setup) |
| `npm test` | Unit tests for the security-sensitive helpers (redirect safety, search sanitising, CSV and HTML escaping) |
| `npm run test:sql` | Runs `schema.sql`, `storage.sql` and `seed.sql` in an in-process Postgres and checks the RLS policies, triggers and RPCs (no Supabase project needed) |

## How access control works

The browser holds the public anon key, so every rule that matters lives in Postgres:

- **RLS on every table.** Employees read only their own tasks; chats only for members; notifications only their own.
- **Privileged columns are guarded.** A trigger blocks anyone but an admin from changing `role`, `status` or `email`, and anyone but a Super Admin from touching a Super Admin. Assignees can change only a task's `status` and `progress`.
- **Memberships are written by `SECURITY DEFINER` functions** (`open_direct_chat`, `create_group_chat`, `mark_chat_read`), so nobody can add themselves to someone else's chat.
- **History and audit rows are written by triggers**, never by the client.
- **Storage** — chat files live under `<chat id>/…` and are readable only by members of that chat; avatars are writable only inside your own folder. Files are opened through 60-second signed URLs.
- **Server actions re-check** the caller's role and validate input with Zod before touching the database; deleting or demoting people goes through the service-role client only after those checks.
- **Reports** are SQL functions that run with the caller's rights, so they are scoped by RLS and not limited by PostgREST's 1000-row response cap.

## Project layout

```
src/
  middleware.ts            session refresh + route protection (must live in src/)
  app/
    (auth)/                login, forgot / reset password
    (app)/                 dashboard, employees, tasks, chat, notifications, reports, activity, profile
    api/                   /api/employees, /api/tasks, /api/reports/completed, /api/health
    auth/                  callback (email links) and signout
    setup/                 first-run instructions
  components/              ui/, layout/, chat/, tasks/, employees/, profile/, dashboard/, notifications/
  lib/
    actions/               server actions (employees, tasks, chat, profile, notifications)
    supabase/              browser, server, service-role clients and middleware helper
    queries/               shared query helpers      auth.ts  permissions.ts  email.ts  reports.ts  tasks.ts
  store/                   Zustand (sidebar)
supabase/
  schema.sql  storage.sql  seed.sql
  tests/                   SQL test suite (npm run test:sql)
tests/                     unit tests (npm test)
```

### Data model

`roles` · `users` (1:1 with `auth.users`) · `profiles` · `employees` · `tasks` · `task_assignments` · `task_comments` · `task_history` · `chats` · `chat_participants` · `chat_messages` · `notifications` · `activity_logs`

Tables that point at a person reference `profiles(id)`; this is what lets PostgREST embed `profiles(full_name)` in queries.

## Deploying

1. Set the same environment variables on your host (Vercel, etc.). Keep `SUPABASE_SERVICE_ROLE_KEY` server-side.
2. In Supabase, set the Site URL and redirect URL to the production domain.
3. Verify the domain you send mail from in Resend.
4. `npm run build && npm start`, or let the platform build it.

## Limitations

- Chat and notification **realtime** use Supabase Realtime; they are covered by the code path and by the SQL tests (RLS decides what each person receives) but not by an automated browser test.
- Email delivery depends on Resend and is not exercised by the tests.
- Chat messages cannot be edited or deleted, and members cannot leave a group yet.
- Newly created people start with a temporary password rather than an emailed invite link.
