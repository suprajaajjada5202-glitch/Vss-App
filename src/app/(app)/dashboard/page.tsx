import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { WorkChart } from "@/components/dashboard/work-chart";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Badge, priorityTone, statusTone } from "@/components/ui/badge";
import { activityLink, describeActivity } from "@/lib/activity";
import { PENDING_STATUSES, TASK_STATUSES, isOverdue, statusLabel } from "@/lib/tasks";
import { firstOf, formatDate, relativeTime, todayISO } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [employees, statusCounts, overdue, activities, notes, mine, trend] = await Promise.all([
    supabase.from("employees").select("*", { count: "exact", head: true }),
    supabase.rpc("task_status_counts"),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .in("status", [...PENDING_STATUSES])
      .lt("due_date", todayISO()),
    supabase
      .from("activity_logs")
      .select("id, action, entity_type, entity_id, metadata, created_at, actor:profiles!activity_logs_actor_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6),
    supabase.from("task_assignments").select("task_id").eq("user_id", user.id).limit(1000),
    supabase.rpc("report_weekly_trend", { p_weeks: 8 }),
  ]);

  const myIds = (mine.data ?? []).map((r) => r.task_id as string);
  const { data: myTasks } = myIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, status, due_date, priority")
        .in("id", myIds)
        .in("status", [...PENDING_STATUSES])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(5)
    : { data: [] as { id: string; title: string; status: string; due_date: string | null; priority: string }[] };

  const counts = new Map<string, number>(
    ((statusCounts.data ?? []) as { status: string; n: number }[]).map((r) => [r.status, Number(r.n)])
  );
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const pending = PENDING_STATUSES.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);
  const completed = counts.get("completed") ?? 0;
  const buckets = TASK_STATUSES.map((s) => ({ name: statusLabel(s), value: counts.get(s) ?? 0 }));
  const weekly = ((trend.data ?? []) as { week_start: string; created: number; completed: number }[]).map((r) => ({
    week: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(`${r.week_start}T00:00:00`)),
    created: Number(r.created),
    completed: Number(r.completed),
  }));

  const stats = [
    { label: "Total employees", value: employees.count ?? 0, href: "/employees" },
    { label: "Total tasks", value: total, href: "/tasks" },
    { label: "Pending tasks", value: pending, href: "/tasks?status=pending", note: overdue.count ? `${overdue.count} overdue` : null, noteHref: "/tasks?overdue=1" },
    { label: "Completed tasks", value: completed, href: "/tasks?status=completed" },
  ];

  return (
    <div>
      <PageHeader
        kicker={formatDate(new Date().toISOString())}
        title={`Welcome back, ${user.fullName.split(" ")[0]}`}
        description={
          user.role === "employee"
            ? "Your tasks, notifications and recent activity."
            : "Company-wide numbers for the work you can see."
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="border-l-[3px] border-l-teal bg-panel px-4 py-4 shadow-[var(--shadow)]">
            <Link href={stat.href} className="block hover:text-teal">
              <p className="font-mono text-3xl font-medium">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </Link>
            {stat.note ? (
              <Link href={stat.noteHref as string} className="mt-1 inline-block text-xs font-medium text-danger">
                {stat.note}
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="bg-panel p-5">
          <h2 className="mb-4 text-lg font-medium">Tasks by status</h2>
          <WorkChart data={buckets} label="Number of tasks in each status" />
        </section>
        <section className="bg-panel p-5">
          <h2 className="mb-4 text-lg font-medium">Last 8 weeks</h2>
          <TrendChart data={weekly} />
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="bg-panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Notifications</h2>
            <Link href="/notifications" className="text-sm text-teal">
              View all
            </Link>
          </div>
          <ul className="space-y-3">
            {(notes.data ?? []).map((n) => (
              <li key={n.id} className="border-b border-line pb-3 last:border-0">
                <Link href={n.link ?? "/notifications"} className="block hover:text-teal">
                  <p className={`text-sm ${n.read_at ? "" : "font-semibold"}`}>
                    {!n.read_at ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-copper align-middle" aria-label="unread" /> : null}
                    {n.title}
                  </p>
                  <p className="text-xs text-muted">{n.body}</p>
                </Link>
                <p className="mt-1 font-mono text-[11px] text-muted">{relativeTime(n.created_at)}</p>
              </li>
            ))}
            {!notes.data?.length ? <p className="text-sm text-muted">You are all caught up.</p> : null}
          </ul>
        </section>

        <section className="bg-panel p-5">
          <h2 className="mb-4 text-lg font-medium">My open tasks</h2>
          <ul className="space-y-3">
            {(myTasks ?? []).map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/tasks/${task.id}`} className="block truncate text-sm hover:text-teal">
                    {task.title}
                  </Link>
                  <p className={`text-xs ${isOverdue(task) ? "font-medium text-danger" : "text-muted"}`}>
                    Due {formatDate(task.due_date)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
                  <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                </div>
              </li>
            ))}
            {!myTasks?.length ? <p className="text-sm text-muted">Nothing assigned to you right now.</p> : null}
          </ul>
        </section>
      </div>

      <section className="mt-6 bg-panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent activity</h2>
          <Link href="/activity" className="text-sm text-teal">
            Activity log
          </Link>
        </div>
        <ul className="space-y-3">
          {(activities.data ?? []).map((a) => {
            const actor = firstOf(a.actor);
            const href = activityLink(a);
            const text = describeActivity(a);
            return (
              <li key={a.id} className="text-sm">
                <span className="font-medium">{actor?.full_name ?? "System"}</span>{" "}
                {href ? (
                  <Link href={href} className="text-muted hover:text-teal">
                    {text}
                  </Link>
                ) : (
                  <span className="text-muted">{text}</span>
                )}
                <span className="ml-2 font-mono text-[11px] text-muted">{relativeTime(a.created_at)}</span>
              </li>
            );
          })}
          {!activities.data?.length ? <p className="text-sm text-muted">No activity recorded yet.</p> : null}
        </ul>
      </section>
    </div>
  );
}
