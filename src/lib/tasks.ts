import { formatDate, todayISO } from "@/lib/utils";
import type { TaskHistory } from "@/lib/types";

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "completed", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const PENDING_STATUSES = ["todo", "in_progress", "blocked"] as const;

export const statusLabel = (status: string) => status.replace("_", " ");

export function isOverdue(task: { due_date: string | null; status: string }) {
  return Boolean(task.due_date) && (PENDING_STATUSES as readonly string[]).includes(task.status) && (task.due_date as string) < todayISO();
}

/** completed_at is a timestamp, due_date a plain date. */
export function completedLate(task: { due_date: string | null; completed_at: string | null }) {
  return Boolean(task.due_date && task.completed_at && task.completed_at.slice(0, 10) > task.due_date);
}

type Change = { from?: unknown; to?: unknown; changed?: boolean };

/** Turn a task_history row into a sentence. `names` maps profile id -> full name. */
export function describeHistory(entry: TaskHistory, names: Map<string, string>) {
  const d = entry.details ?? {};
  const who = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "someone") : "someone");
  switch (entry.action) {
    case "created":
      return `Created the task${d.priority ? ` (${d.priority} priority)` : ""}`;
    case "assigned":
      return `Assigned to ${who(d.user_id)}`;
    case "unassigned":
      return `Removed ${who(d.user_id)} from the task`;
    case "status_changed":
      return `Status changed from ${statusLabel(String(d.from))} to ${statusLabel(String(d.to))}`;
    case "progress_updated":
      return `Progress changed from ${d.from}% to ${d.to}%`;
    case "updated": {
      const parts: string[] = [];
      const title = d.title as Change | undefined;
      const priority = d.priority as Change | undefined;
      const due = d.due_date as Change | undefined;
      if (title) parts.push(`renamed to “${title.to}”`);
      if (priority) parts.push(`priority ${priority.from} → ${priority.to}`);
      if (due) parts.push(`due date ${formatDate(due.from as string | null)} → ${formatDate(due.to as string | null)}`);
      if (d.description) parts.push("description edited");
      return parts.length ? `Edited: ${parts.join(", ")}` : "Edited the task";
    }
    default:
      return entry.action.replaceAll("_", " ");
  }
}
