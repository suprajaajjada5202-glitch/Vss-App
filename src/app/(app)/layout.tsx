import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { supabaseDashboardLink } from "@/lib/supabase/config";
import { signupsWarningFor } from "@/lib/supabase/status";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { NotificationListener } from "@/components/notifications/notification-listener";
import { SessionProvider } from "@/components/providers/session-provider";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ count }, signupsOpen] = await Promise.all([
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
    signupsWarningFor(user.role),
  ]);
  const providersLink = supabaseDashboardLink("/auth/providers");

  return (
    <SessionProvider user={user}>
      <div className="flex min-h-screen bg-paper">
        <Sidebar user={user} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} unread={count ?? 0} />
          {signupsOpen ? (
            <div role="status" className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm">
              <strong>Public sign-ups are on</strong> for this Supabase project, so anyone can register and see the
              employee directory. Turn off “Allow new users to sign up”
              {providersLink ? (
                <>
                  {" "}
                  under{" "}
                  <a href={providersLink} target="_blank" rel="noreferrer" className="font-medium underline">
                    Authentication → Sign In / Providers
                  </a>
                </>
              ) : null}
              .
            </div>
          ) : null}
          {user.mustChangePassword ? (
            <div role="status" className="border-b border-copper/30 bg-copper/10 px-4 py-2 text-sm">
              You are signed in with a temporary password.{" "}
              <Link href="/profile#password" className="font-medium text-copper underline">
                Choose a new password
              </Link>
              .
            </div>
          ) : null}
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
      <NotificationListener userId={user.id} />
    </SessionProvider>
  );
}
