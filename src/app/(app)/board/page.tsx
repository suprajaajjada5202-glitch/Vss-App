import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canCreateTasks } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { KanbanBoard, type BoardTask } from "@/components/tasks/kanban-board";
import { PENDING_STATUSES, TASK_PRIORITIES } from "@/lib/tasks";
import { cn, firstOf, sanitizeSearch } from "@/lib/utils";

export const metadata = { title: "Board" };

const DONE_LIMIT = 30;
const SELECT =
  "id, title, description, status, priority, progress, due_date, comments:task_comments(count), assignments:task_assignments(user_id, profile:profiles!task_assignments_user_id_fkey(full_name, avatar_url))";

type Row = {
  id: string;
  title: string;
  description: string | null;
  status: BoardTask["status"];
  priority: string;
  progress: number;
  due_date: string | null;
  comments: { count: number }[] | null;
  assignments: { user_id: string; profile: BoardTask["people"][number] | BoardTask["people"] | null }[] | null;
};

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; priority?: string; mine?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = sanitizeSearch(params.q);
  const priority = (TASK_PRIORITIES as readonly string[]).includes(params.priority ?? "") ? params.priority : undefined;
  const mine = params.mine === "1";
  const manager = canCreateTasks(user.role);
  const supabase = await createClient();

  let mineIds: string[] | null = null;
  if (mine) {
    const { data } = await supabase.from("task_assignments").select("task_id").eq("user_id", user.id).limit(1000);
    mineIds = (data ?? []).map((r) => r.task_id as string);
  }

  // Open work in full; only the most recently finished tasks in Done so the column stays readable.
  const build = (done: boolean) => {
    let query = supabase.from("tasks").select(SELECT);
    query = done
      ? query.eq("status", "completed").order("completed_at", { ascending: false }).limit(DONE_LIMIT)
      : query.in("status", [...PENDING_STATUSES]).order("due_date", { ascending: true, nullsFirst: false }).limit(500);
    if (priority) query = query.eq("priority", priority);
    if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    if (mineIds) query = query.in("id", mineIds.length ? mineIds : ["00000000-0000-0000-0000-000000000000"]);
    return query;
  };
  const [open, done] = await Promise.all([build(false), build(true)]);

  const tasks: BoardTask[] = ([...(open.data ?? []), ...(done.data ?? [])] as Row[]).map((t) => {
    const assignments = t.assignments ?? [];
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      progress: t.progress,
      due_date: t.due_date,
      comments: Number(t.comments?.[0]?.count ?? 0),
      people: assignments.map((a) => firstOf(a.profile)).filter((p): p is BoardTask["people"][number] => Boolean(p)),
      canMove: manager || assignments.some((a) => a.user_id === user.id),
    };
  });

  const tabs = [
    { href: "/board", label: "Board", current: true },
    { href: "/tasks", label: "List" },
  ];
  const control = "h-9 rounded-md border border-line bg-panel px-3 text-sm";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Board</h1>
          <p className="mt-1 text-sm text-muted">
            Drag a card to another column to change its status.
            {(done.data?.length ?? 0) >= DONE_LIMIT ? ` Done shows the ${DONE_LIMIT} most recent.` : ""}
          </p>
        </div>
        {manager ? (
          <Link href="/tasks/new" className="inline-flex h-9 w-fit items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90">
            <Plus size={16} aria-hidden />
            Add task
          </Link>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="inline-flex w-fit rounded-md bg-line/40 p-1 text-sm" aria-label="Task views">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.current ? "page" : undefined}
              className={cn("rounded px-3 py-1", t.current ? "bg-panel font-medium shadow-sm" : "text-muted hover:text-ink")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap gap-2" role="search">
          <label className={cn(control, "flex w-full items-center gap-2 sm:w-56")}>
            <Search size={15} className="text-muted" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search tasks…" aria-label="Search tasks" className="w-full bg-transparent outline-none" />
          </label>
          <select name="priority" defaultValue={priority ?? ""} aria-label="Priority" className={control}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p} className="capitalize">
                {p}
              </option>
            ))}
          </select>
          {manager ? (
            <label className={cn(control, "flex items-center gap-2")}>
              <input type="checkbox" name="mine" value="1" defaultChecked={mine} />
              Mine only
            </label>
          ) : null}
          <button className={cn(control, "hover:bg-paper")}>Filter</button>
          {q || priority || mine ? (
            <Link href="/board" className="inline-flex h-9 items-center px-2 text-sm text-muted hover:text-teal">
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      <KanbanBoard tasks={tasks} canCreate={manager} />
    </div>
  );
}
