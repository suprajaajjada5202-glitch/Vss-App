import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canCreateTasks } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Badge, priorityTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination, buildHref } from "@/components/ui/pagination";
import { PENDING_STATUSES, TASK_PRIORITIES, TASK_STATUSES, isOverdue, statusLabel } from "@/lib/tasks";
import { firstOf, formatDate, pageCount, parsePage, sanitizeSearch, todayISO } from "@/lib/utils";

export const metadata = { title: "Tasks" };

const PAGE_SIZE = 10;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; q?: string; mine?: string; overdue?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = sanitizeSearch(params.q);
  const status = params.status === "pending" || (TASK_STATUSES as readonly string[]).includes(params.status ?? "") ? params.status : undefined;
  const priority = (TASK_PRIORITIES as readonly string[]).includes(params.priority ?? "") ? params.priority : undefined;
  const mine = params.mine === "1";
  const overdue = params.overdue === "1";
  const page = parsePage(params.page);
  const supabase = await createClient();

  let mineIds: string[] | null = null;
  if (mine) {
    const { data } = await supabase.from("task_assignments").select("task_id").eq("user_id", user.id).limit(1000);
    mineIds = (data ?? []).map((r) => r.task_id as string);
  }

  let query = supabase
    .from("tasks")
    .select(
      "id, title, priority, status, progress, due_date, assignments:task_assignments(user_id, profile:profiles!task_assignments_user_id_fkey(full_name))",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (status === "pending") query = query.in("status", [...PENDING_STATUSES]);
  else if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  if (overdue) query = query.in("status", [...PENDING_STATUSES]).lt("due_date", todayISO());
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (mineIds) query = mineIds.length ? query.in("id", mineIds) : query.in("id", ["00000000-0000-0000-0000-000000000000"]);

  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = data ?? [];
  const pages = pageCount(count, PAGE_SIZE);
  const hrefFor = (n: number) =>
    buildHref("/tasks", { q, status, priority, mine: mine ? 1 : undefined, overdue: overdue ? 1 : undefined, page: n > 1 ? n : undefined });
  const filtered = Boolean(q || status || priority || mine || overdue);
  const control = "h-10 border border-line bg-panel px-3 text-sm";

  return (
    <div>
      <PageHeader
        kicker="Work"
        title="Tasks"
        description={
          canCreateTasks(user.role)
            ? "All tasks you can see. The stripe on the left shows priority."
            : "Tasks assigned to you. The stripe on the left shows priority."
        }
        actions={
          <>
            <Link href="/board">
              <Button variant="ghost">Board view</Button>
            </Link>
            {canCreateTasks(user.role) ? (
              <Link href="/tasks/new">
                <Button>New task</Button>
              </Link>
            ) : null}
          </>
        }
      />

      <form className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto_auto]" role="search">
        <input name="q" defaultValue={q} placeholder="Search title or description…" aria-label="Search tasks" className={control} />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={control}>
          <option value="">Any status</option>
          <option value="pending">Pending (open)</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={priority ?? ""} aria-label="Priority" className={control}>
          <option value="">Any priority</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Mine
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="overdue" value="1" defaultChecked={overdue} /> Overdue
          </label>
        </div>
        <div className="flex gap-2">
          <button className="h-10 flex-1 bg-teal px-4 text-sm text-white hover:bg-teal-deep">Apply</button>
          {filtered ? (
            <Link href="/tasks" className="inline-flex h-10 items-center border border-line px-3 text-sm hover:bg-paper">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {!rows.length ? (
        <EmptyState
          title={filtered ? "No tasks match these filters" : "No tasks yet"}
          body={filtered ? "Clear the filters to see everything." : canCreateTasks(user.role) ? "Create the first task." : "Nothing has been assigned to you."}
        />
      ) : (
        <ul className="grid gap-3">
          {rows.map((task) => {
            const names = (task.assignments ?? [])
              .map((a: { profile: unknown }) => firstOf(a.profile as { full_name: string } | { full_name: string }[])?.full_name)
              .filter(Boolean);
            const late = isOverdue(task);
            return (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="flex flex-col gap-2 border-l-[3px] bg-panel px-4 py-4 hover:bg-paper sm:flex-row sm:items-center sm:justify-between"
                  style={{
                    borderLeftColor:
                      task.priority === "critical"
                        ? "var(--danger)"
                        : task.priority === "high"
                          ? "var(--copper)"
                          : task.priority === "medium"
                            ? "var(--gold)"
                            : "var(--line)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{task.title}</p>
                    <p className="text-xs text-muted">
                      <span className={late ? "font-medium text-danger" : undefined}>
                        Due {formatDate(task.due_date)}
                        {late ? " (overdue)" : ""}
                      </span>{" "}
                      · {task.progress}% complete · {names.length ? names.join(", ") : "Unassigned"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
                    <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} pages={pages} total={count} hrefFor={hrefFor} />
    </div>
  );
}
