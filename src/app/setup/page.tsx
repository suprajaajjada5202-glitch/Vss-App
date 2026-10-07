import { redirect } from "next/navigation";
import { isSupabaseConfigured, supabaseDashboardLink } from "@/lib/supabase/config";
import { checkDatabase, publicSignupsEnabled } from "@/lib/supabase/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup" };

const code = "font-mono text-ink";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-teal">VSS PULSE · SETUP</p>
      <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

function DashLink({ path, children }: { path: string; children: React.ReactNode }) {
  const href = supabaseDashboardLink(path);
  if (!href) return <>{children}</>;
  return (
    <a className="text-teal underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default async function SetupPage() {
  // 1. Keys
  if (!isSupabaseConfigured()) {
    return (
      <Shell title="Connect Supabase before signing in">
        <p className="mt-3 text-sm text-muted">
          The app is running, but <code className={code}>.env.local</code> does not have real project keys yet.
          Add them, then restart the dev server.
        </p>
        <ol className="mt-8 list-decimal space-y-4 pl-5 text-sm">
          <li>
            Create a project at{" "}
            <a className="text-teal underline" href="https://supabase.com" target="_blank" rel="noreferrer">
              supabase.com
            </a>
            .
          </li>
          <li>
            Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code> and
            fill in, from Project Settings → API:
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>
                <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> — the <strong>API URL</strong>{" "}
                (<code className="font-mono">https://&lt;project-ref&gt;.supabase.co</code>), not the dashboard address
              </li>
              <li>
                <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
              </li>
              <li>
                <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> (server only; needed to add employees)
              </li>
            </ul>
          </li>
          <li>Restart <code className="font-mono">npm run dev</code>. This page then checks the database for you.</li>
        </ol>
        <pre className="mt-8 overflow-x-auto border border-line bg-panel p-4 font-mono text-xs">
          {`cp .env.example .env.local
# paste keys, save, then restart npm run dev`}
        </pre>
      </Shell>
    );
  }

  // 2. Database
  const status = await checkDatabase();
  if (status.state === "ready") redirect("/login");

  if (status.state === "error") {
    return (
      <Shell title="Cannot use this Supabase project yet">
        <p role="alert" className="mt-3 text-sm text-danger">
          {status.message}
        </p>
        <p className="mt-4 text-sm text-muted">
          Check <code className={code}>NEXT_PUBLIC_SUPABASE_URL</code> and the keys in{" "}
          <code className={code}>.env.local</code> (Project Settings → API), restart the server, then reload this page.
        </p>
      </Shell>
    );
  }

  const signupsOpen = await publicSignupsEnabled();
  return (
    <Shell title="Keys connected. Set up the database">
      <p className="mt-3 text-sm text-muted">
        Your Supabase keys work, but the database tables are not there yet. Do these in order, then reload this page.
      </p>
      <ol className="mt-8 list-decimal space-y-5 pl-5 text-sm">
        <li>
          Easiest: add <code className="font-mono">SUPABASE_DB_PASSWORD=…</code> to{" "}
          <code className="font-mono">.env.local</code> and run <code className="font-mono">npm run db:setup</code>.
          Or open the <DashLink path="/sql/new">SQL editor</DashLink> and run, in this order (paste each file&apos;s
          whole contents):
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>
              <code className="font-mono">supabase/schema.sql</code>
            </li>
            <li>
              <code className="font-mono">supabase/storage.sql</code>
            </li>
          </ul>
        </li>
        <li>
          <DashLink path="/auth/providers">Authentication → Sign In / Providers</DashLink>: turn <strong>off</strong>{" "}
          “Allow new users to sign up”.{" "}
          {signupsOpen ? (
            <span className="font-medium text-danger">Currently ON: anyone could register.</span>
          ) : (
            <span className="text-ok">Already off.</span>
          )}
        </li>
        <li>
          <DashLink path="/auth/url-configuration">Authentication → URL Configuration</DashLink>: set Site URL to{" "}
          <code className="font-mono">{process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}</code> and add{" "}
          <code className="font-mono">/auth/callback</code> on that address to the redirect URLs.
        </li>
        <li>
          <DashLink path="/auth/users">Authentication → Users</DashLink> → Add user (email + password, tick{" "}
          <em>Auto Confirm User</em>). This will be your Super Admin.
        </li>
        <li>
          Make them Super Admin: <code className="font-mono">npm run db:setup -- --promote their@email</code> (or put the
          email into <code className="font-mono">supabase/seed.sql</code> and run it in the SQL editor).
        </li>
      </ol>
      <a href="/setup" className="mt-8 inline-flex h-10 w-fit items-center bg-teal px-4 text-sm text-white hover:bg-teal-deep">
        Check again
      </a>
    </Shell>
  );
}
