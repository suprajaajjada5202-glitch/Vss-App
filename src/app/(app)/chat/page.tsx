import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { ChatShell, type Person } from "@/components/chat/chat-shell";
import { firstOf } from "@/lib/utils";
import type { ChatSummary } from "@/lib/types";

export default async function ChatPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: rooms }, { data: users }] = await Promise.all([
    supabase.rpc("my_chats"),
    supabase
      .from("users")
      .select("id, status, profile:profiles(full_name, avatar_url, department)")
      .neq("status", "inactive"),
  ]);

  const chats: ChatSummary[] = (rooms ?? []).map((r: ChatSummary) => ({ ...r, unread: Number(r.unread) }));
  const people: Person[] = (users ?? [])
    .map((u) => {
      const p = firstOf(u.profile);
      return {
        id: u.id as string,
        full_name: p?.full_name ?? "Unnamed",
        avatar_url: p?.avatar_url ?? null,
        department: p?.department ?? null,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div>
      <PageHeader
        kicker="Team chat"
        title="Messages"
        description="Direct messages, group chats and the company announcement channel, delivered in real time."
      />
      <Suspense>
        <ChatShell meId={user.id} role={user.role} chats={chats} people={people} />
      </Suspense>
    </div>
  );
}
