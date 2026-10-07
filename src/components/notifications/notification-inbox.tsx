"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/store/notifications";
import { cn, relativeTime } from "@/lib/utils";
import type { AppNotification } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  task_assigned: "Task",
  task_status: "Task",
  chat_message: "Chat",
  profile_updated: "Profile",
  announcement: "Announcement",
  system: "System",
};

const tab = (active: boolean) =>
  cn("inline-flex h-9 items-center border px-3 text-sm", active ? "border-teal bg-teal text-white" : "border-line bg-panel hover:bg-paper");

/**
 * Updates its own state straight away (optimistic) and then asks the server to re-sync; the page does
 * not depend on the router refresh landing for the UI to be correct.
 */
export function NotificationInbox({ items, unreadOnly }: { items: AppNotification[]; unreadOnly: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState(false);
  const decrement = useNotificationStore((s) => s.decrement);
  const clear = useNotificationStore((s) => s.clear);

  useEffect(() => setRows(items), [items]);

  const now = () => new Date().toISOString();
  const visible = unreadOnly ? rows.filter((n) => !n.read_at) : rows;
  const unreadHere = rows.filter((n) => !n.read_at).length;

  async function markOne(id: string) {
    setRows((cur) => cur.map((n) => (n.id === id ? { ...n, read_at: now() } : n)));
    decrement();
    try {
      await markNotificationRead(id);
    } catch {
      toast.error("Could not mark that notification as read");
    }
    router.refresh();
  }

  async function markAll() {
    setBusy(true);
    setRows((cur) => cur.map((n) => (n.read_at ? n : { ...n, read_at: now() })));
    clear();
    try {
      await markAllNotificationsRead();
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Could not mark notifications as read");
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-2" aria-label="Filter">
          <Link href="/notifications" className={tab(!unreadOnly)}>
            All
          </Link>
          <Link href="/notifications?filter=unread" className={tab(unreadOnly)}>
            Unread
          </Link>
        </nav>
        <Button variant="ghost" type="button" disabled={busy || unreadHere === 0} onClick={markAll}>
          Mark all as read
        </Button>
      </div>

      <ul className="divide-y divide-line border border-line bg-panel">
        {visible.map((n) => (
          <li key={n.id} className={cn("flex items-start justify-between gap-4 px-4 py-4", n.read_at && "opacity-70")}>
            <div className="min-w-0">
              <p className={cn("text-sm", !n.read_at && "font-semibold")}>{n.title}</p>
              {n.body ? <p className="break-words text-sm text-muted">{n.body}</p> : null}
              <p className="mt-1 font-mono text-[11px] text-muted">
                {TYPE_LABEL[n.type] ?? n.type} · {relativeTime(n.created_at)}
              </p>
              {n.link ? (
                <Link href={n.link} className="mt-2 inline-block text-sm text-teal">
                  Open
                </Link>
              ) : null}
            </div>
            {!n.read_at ? (
              <Button size="sm" variant="ghost" type="button" onClick={() => markOne(n.id)}>
                Mark read
              </Button>
            ) : null}
          </li>
        ))}
        {!visible.length ? (
          <li className="px-4 py-8 text-sm text-muted">{unreadOnly ? "No unread notifications." : "No notifications yet."}</li>
        ) : null}
      </ul>
    </>
  );
}
