import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "teal" | "copper" | "gold" | "ok" | "danger";
}) {
  const tones = {
    muted: "bg-paper text-muted border-line",
    teal: "bg-teal/10 text-teal border-teal/20",
    copper: "bg-copper/10 text-copper border-copper/20",
    gold: "bg-gold/15 text-ink dark:text-gold border-gold/30",
    ok: "bg-ok/10 text-ok border-ok/20",
    danger: "bg-danger/10 text-danger border-danger/20",
  };
  return (
    <span className={cn("inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function priorityTone(priority: string) {
  if (priority === "critical") return "danger" as const;
  if (priority === "high") return "copper" as const;
  if (priority === "medium") return "gold" as const;
  return "muted" as const;
}

export function statusTone(status: string) {
  if (status === "completed") return "ok" as const;
  if (status === "blocked" || status === "cancelled") return "danger" as const;
  if (status === "in_progress") return "teal" as const;
  return "muted" as const;
}
