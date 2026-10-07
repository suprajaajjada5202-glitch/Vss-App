import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { Pagination, buildHref } from "@/components/ui/pagination";
import { NotificationInbox } from "@/components/notifications/notification-inbox";
import { pageCount, parsePage } from "@/lib/utils";
import type { AppNotification } from "@/lib/types";

export const metadata = { title: "Notifications" };

const PAGE_SIZE = 20;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const page = parsePage(params.page);
  const unreadOnly = params.filter === "unread";
  const supabase = await createClient();

  let query = supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (unreadOnly) query = query.is("read_at", null);
  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  return (
    <div>
      <PageHeader
        kicker="Inbox"
        title="Notifications"
        description="New tasks, status changes, messages, profile updates and company announcements."
      />
      <NotificationInbox items={(data ?? []) as AppNotification[]} unreadOnly={unreadOnly} />
      <Pagination
        page={page}
        pages={pageCount(count, PAGE_SIZE)}
        total={count}
        hrefFor={(n) => buildHref("/notifications", { filter: unreadOnly ? "unread" : undefined, page: n > 1 ? n : undefined })}
      />
    </div>
  );
}
