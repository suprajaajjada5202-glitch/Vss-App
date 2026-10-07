type Log = { action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> | null };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const label = (v: unknown) => String(v ?? "").replaceAll("_", " ");

/** One-line, human description of an activity_logs row (without the actor's name). */
export function describeActivity(log: Log) {
  const m = log.metadata ?? {};
  const title = str(m.title);
  const name = str(m.name) ?? str(m.email);
  switch (log.action) {
    case "task_created":
      return `created task${title ? ` “${title}”` : ""}`;
    case "task_updated":
      return `edited task${title ? ` “${title}”` : ""}`;
    case "task_status_updated":
      return `moved${title ? ` “${title}”` : " a task"} to ${label(m.status)}${typeof m.progress === "number" ? ` (${m.progress}%)` : ""}`;
    case "task_deleted":
      return `deleted task${title ? ` “${title}”` : ""}`;
    case "employee_created":
      return `added employee${name ? ` ${name}` : ""}`;
    case "employee_updated":
      return `updated employee${name ? ` ${name}` : ""}`;
    case "employee_deleted":
      return `deleted employee${name ? ` ${name}` : ""}`;
    case "profile_updated":
      return "updated their profile";
    case "user_role_changed":
      return `changed a role from ${label(m.from)} to ${label(m.to)}`;
    case "user_status_changed":
      return `changed an account status from ${label(m.from)} to ${label(m.to)}`;
    default:
      return label(log.action);
  }
}

/** Where the entity lives in the app, if it still exists. */
export function activityLink(log: Log) {
  if (!log.entity_id || log.action.endsWith("_deleted")) return null;
  if (log.entity_type === "task") return `/tasks/${log.entity_id}`;
  if (["employee", "user", "profile"].includes(log.entity_type)) return `/employees/${log.entity_id}`;
  return null;
}
