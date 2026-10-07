"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ensureDirectChat } from "@/lib/actions/chat";
import { Button } from "@/components/ui/button";

export function MessageButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await ensureDirectChat(userId);
          if ("chatId" in res && res.chatId) router.push(`/chat?c=${res.chatId}`);
          else if ("error" in res) toast.error(res.error);
        })
      }
    >
      {pending ? "Opening…" : "Message"}
    </Button>
  );
}
