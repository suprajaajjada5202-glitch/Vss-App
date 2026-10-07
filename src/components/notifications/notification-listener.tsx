"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/types";

/**
 * Subscribes to this user's notification rows over Supabase Realtime, shows a toast for each
 * new unread one, and refreshes server data so the unread badge stays current.
 */
export function NotificationListener({ userId }: { userId: string }) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const note = payload.new as AppNotification;
          scheduleRefresh();
          if (note.read_at) return; // a "mark read" update, nothing to announce

          // Do not toast about the conversation that is already on screen.
          const here = `${window.location.pathname}${window.location.search}`;
          if (note.link && here === note.link) return;

          toast(note.title, {
            description: note.body ?? undefined,
            action: note.link
              ? { label: "Open", onClick: () => router.push(note.link as string) }
              : undefined,
          });
        }
      )
      .subscribe();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
