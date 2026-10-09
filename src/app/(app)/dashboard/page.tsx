import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleCheckBig,
  Download,
  FolderKanban,
  Info,
  ListPlus,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canCreateTasks, canSeeAllReports } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui/avatar";
import { Badge, statusTone } from "@/components/ui/badge";
import { OverviewChart, type DayPoint } from "@/components/dashboard/overview-chart";
import { StatusDonut } from "@/components/dashboard/status-donut";
import { PENDING_STATUSES, TASK_STATUSES, isOverdue, statusLabel } from "@/lib/tasks";
import { cn, firstOf, formatDate, todayISO } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shortDate = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(ms));

/** Percentage change, or null when there is nothing to compare against. */
function change(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

const STATUS_COLORS: Record<string, string> = {
  todo: "var(--muted)",
  in_progress: "var(--teal)",
  blocked: "var(--copper)",
  completed: "var(--ok)",
  cancelled: "var(--line)",
};

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-muted",
  medium: "bg-gold",
  high: "bg-copper",
  critical: "bg-danger",
};

function dueLabel(due: string | null) {
  if (!due) return "No due date";
  const today = todayISO();
  if (due < today) return `Overdue · ${formatDate(due)}`;
  if (due === today) return "Due today";
  if (due === isoDay(Date.now() + DAY)) return "Due tomorrow";
  return `Due ${formatDate(due)}`;
}

type AssigneeRow = { profile: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[] | null };

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const manager = canSeeAllReports(user.role);

  const now = Date.now();
  const from90 = new Date(now - 90 * DAY).toISOString();
  const from30 = new Date(now - 30 * DAY).toISOString();
  const year = new Date().getFullYear();
  const years = [year, year - 1, year - 2];

  // Every task touched in the last 90 days, for the chart and the 30-day comparisons.
  // PostgREST caps a response at 1000 rows, so page through.
  const recentRows: { created_at: string; completed_at: string | null }[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data } = await supabase
      .from("tasks")
      .select("created_at, completed_at")
      .or(`created_at.gte.${from90},completed_at.gte.${from90}`)
      .order("created_at", { ascending: true })
      .range(offset, offset + 999);
    recentRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const [employees, statusCounts, summary, performance, recent, mine, ...yearCounts] = await Promise.all([
    supabase.from("employees").select("*", { count: "exact", head: true }),
    supabase.rpc("task_status_counts"),
    supabase.rpc("report_summary", { p_from: from30 }),
    supabase.rpc("report_performance", { p_from: from30 }),
    supabase
      .from("tasks")
      .select(
        "id, title, status, progress, due_date, created_at, assignments:task_assignments(profile:profiles!task_assignments_user_id_fkey(full_name, avatar_url))"
      )
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("task_assignments").select("task_id").eq("user_id", user.id).limit(1000),
    ...years.map((y) =>
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("completed_at", `${y}-01-01`)
        .lt("completed_at", `${y + 1}-01-01`)
    ),
  ]);

  // My open tasks, nearest deadline first.
  const myIds = (mine.data ?? []).map((r) => r.task_id as string);
  const upcoming = myIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, status, due_date, priority", { count: "exact" })
        .in("id", myIds)
        .in("status", [...PENDING_STATUSES])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(3)
    : { data: [] as { id: string; title: string; status: string; due_date: string | null; priority: string }[], count: 0 };

  // Top performers of the last 30 days, with their photos.
  const heroes = ((performance.data ?? []) as { user_id: string; full_name: string; completed: number }[])
    .filter((p) => Number(p.completed) > 0)
    .slice(0, 6);
  const { data: heroProfiles } = heroes.length
    ? await supabase.from("profiles").select("id, avatar_url").in("id", heroes.map((h) => h.user_id))
    : { data: [] as { id: string; avatar_url: string | null }[] };
  const avatars = new Map((heroProfiles ?? []).map((p) => [p.id as string, p.avatar_url as string | null]));

  // Daily buckets for the chart.
  const days: DayPoint[] = Array.from({ length: 90 }, (_, i) => ({ date: isoDay(now - (89 - i) * DAY), created: 0, completed: 0 }));
  const index = new Map(days.map((d, i) => [d.date, i]));
  let created30 = 0;
  let createdPrev = 0;
  let completed30 = 0;
  let completedPrev = 0;
  for (const row of recentRows) {
    const c = Date.parse(row.created_at);
    const ci = index.get(row.created_at.slice(0, 10));
    if (ci !== undefined) days[ci].created += 1;
    if (c >= now - 30 * DAY) created30 += 1;
    else if (c >= now - 60 * DAY) createdPrev += 1;
    if (row.completed_at) {
      const d = Date.parse(row.completed_at);
      const di = index.get(row.completed_at.slice(0, 10));
      if (di !== undefined) days[di].completed += 1;
      if (d >= now - 30 * DAY) completed30 += 1;
      else if (d >= now - 60 * DAY) completedPrev += 1;
    }
  }

  const counts = new Map<string, number>(
    ((statusCounts.data ?? []) as { status: string; n: number }[]).map((r) => [r.status, Number(r.n)])
  );
  const totalTasks = [...counts.values()].reduce((a, b) => a + b, 0);
  const active = PENDING_STATUSES.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);
  const slices = TASK_STATUSES.map((s) => ({ name: statusLabel(s), value: counts.get(s) ?? 0, color: STATUS_COLORS[s] }));

  const s = firstOf(summary.data as { completed: number; overdue: number; on_time: number; avg_days: number | null }[] | null);
  const overdue = Number(s?.overdue ?? 0);
  const onTimeRate = s && Number(s.completed) ? Math.round((Number(s.on_time) / Number(s.completed)) * 100) : null;

  const yearly = years.map((y, i) => ({ year: y, count: yearCounts[i]?.count ?? 0 }));
  const maxYear = Math.max(1, ...yearly.map((y) => y.count));

  const stats = [
    {
      label: "Active tasks",
      value: active,
      icon: FolderKanban,
      href: "/tasks?status=pending",
      note: overdue ? { text: `${overdue} overdue`, good: false } : { text: "none overdue", good: true },
      suffix: null,
    },
    {
      label: "New tasks",
      value: created30,
      icon: ListPlus,
      href: "/tasks",
      delta: change(created30, createdPrev),
      suffix: "vs previous 30 days",
    },
    {
      label: "Completed",
      value: completed30,
      icon: CircleCheckBig,
      href: "/tasks?status=completed",
      delta: change(completed30, completedPrev),
      suffix: "vs previous 30 days",
    },
  ];

  const highlights = [
    {
      label: "On-time completion",
      value: onTimeRate === null ? "—" : `${onTimeRate}%`,
      good: onTimeRate === null ? null : onTimeRate >= 80,
    },
    { label: "Avg. days to complete", value: s?.avg_days != null ? `${s.avg_days} d` : "—", good: null },
    { label: "Overdue tasks", value: String(overdue), good: overdue === 0 },
  ];

  const card = "overflow-hidden rounded-md border border-line bg-panel";
  const cardHead = "flex items-center justify-between gap-3 border-b border-line px-5 py-3.5";
  const tabs = [
    { href: "/dashboard", label: "Overview", current: true },
    { href: "/reports", label: "Reports" },
    { href: "/activity", label: "Activities" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Welcome back, {user.fullName.split(" ")[0]}.{" "}
            {manager ? "Company-wide numbers for the work you can see." : "Your tasks and how they are going."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm">
            <CalendarDays size={16} aria-hidden />
            {shortDate(now - 30 * DAY)} – {shortDate(now)}
          </span>
          {manager ? (
            <a
              href="/api/reports/completed?range=30"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm hover:bg-paper"
            >
              <Download size={16} aria-hidden />
              Export
            </a>
          ) : null}
        </div>
      </div>

      <nav className="inline-flex rounded-md bg-line/40 p-1 text-sm" aria-label="Dashboard sections">
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

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const delta = "delta" in stat ? stat.delta : undefined;
          return (
            <Link key={stat.label} href={stat.href} className={cn(card, "block transition hover:border-teal/50")}>
              <div className={cardHead}>
                <span className="text-sm font-medium">{stat.label}</span>
                <Icon size={18} className="text-muted" aria-hidden />
              </div>
              <div className="px-5 py-4">
                <p className="text-3xl font-semibold">{stat.value.toLocaleString("en-IN")}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {"note" in stat && stat.note ? (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-medium",
                        stat.note.good ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"
                      )}
                    >
                      {stat.note.text}
                    </span>
                  ) : delta === null ? (
                    <span className="rounded-full border border-line px-2 py-0.5">no earlier data</span>
                  ) : delta !== undefined ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
                        delta >= 0 ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"
                      )}
                    >
                      {delta >= 0 ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
                      {Math.abs(delta).toFixed(1)}%
                    </span>
                  ) : null}
                  {stat.suffix}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Chart + team */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <OverviewChart data={days} />

        <section className={card}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm text-muted">Team members</p>
            <Link href="/employees" className="text-3xl font-semibold hover:text-teal">
              {(employees.count ?? 0).toLocaleString("en-IN")}
            </Link>
          </div>
          <div className="px-5 py-4">
            <h2 className="text-sm font-medium">Top performers · 30 days</h2>
            {heroes.length ? (
              <ul className="mt-3 flex -space-x-2">
                {heroes.map((h) => (
                  <li key={h.user_id} title={`${h.full_name} · ${h.completed} completed`} className="rounded-sm ring-2 ring-panel">
                    <Link href={`/employees/${h.user_id}`}>
                      <Avatar name={h.full_name} src={avatars.get(h.user_id)} size={40} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">No tasks completed in the last 30 days.</p>
            )}

            <h2 className="mt-6 text-sm font-medium">Highlights</h2>
            <ul className="mt-2 divide-y divide-line">
              {highlights.map((h) => (
                <li key={h.label} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{h.label}</span>
                  <span className="flex items-center gap-1.5 font-medium">
                    {h.good === true ? <ArrowUpRight size={14} className="text-ok" aria-label="good" /> : null}
                    {h.good === false ? <ArrowDownRight size={14} className="text-danger" aria-label="needs attention" /> : null}
                    {h.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* Deadlines, yearly, status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
        <section className={cn(card, "lg:col-span-2 xl:col-span-1")}>
          <div className={cardHead}>
            <h2 className="font-medium">My upcoming deadlines</h2>
            <Link
              href={canCreateTasks(user.role) ? "/tasks/new" : "/tasks?mine=1"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-paper"
            >
              <Plus size={14} aria-hidden />
              {canCreateTasks(user.role) ? "New task" : "My tasks"}
            </Link>
          </div>
          <div className="p-5">
            {upcoming.data?.length ? (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {upcoming.data.map((task) => (
                  <li key={task.id}>
                    <Link href={`/tasks/${task.id}`} className="flex h-full flex-col gap-3 rounded-md border border-line p-4 hover:border-teal/50">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium capitalize">
                          <span className={cn("h-2 w-2 rounded-full", PRIORITY_DOT[task.priority] ?? "bg-muted")} />
                          {task.priority}
                        </span>
                        {task.status === "in_progress" ? (
                          <CheckCircle2 size={16} className="text-teal" aria-label="in progress" />
                        ) : (
                          <Circle size={16} className="text-muted" aria-label={statusLabel(task.status)} />
                        )}
                      </div>
                      <p className={cn("text-sm", isOverdue(task) ? "font-medium text-danger" : "text-muted")}>{dueLabel(task.due_date)}</p>
                      <p className="line-clamp-2 text-sm">{task.title}</p>
                      <span className="mt-auto w-fit rounded-full border border-line px-2 py-0.5 text-xs capitalize">
                        {statusLabel(task.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing assigned to you right now.</p>
            )}
            {(upcoming.count ?? 0) > 3 ? (
              <Link href="/tasks?mine=1" className="mt-4 flex items-center justify-end gap-1.5 text-sm text-muted hover:text-teal">
                Show the other {(upcoming.count ?? 0) - 3} open tasks <ArrowRight size={14} aria-hidden />
              </Link>
            ) : null}
          </div>
        </section>

        <section className={card}>
          <div className={cardHead}>
            <h2 className="flex items-center gap-1.5 font-medium">
              Completed by year
              <span title="Tasks marked completed in each calendar year">
                <Info size={14} className="text-muted" aria-hidden />
              </span>
            </h2>
          </div>
          <ul className="space-y-4 p-5">
            {yearly.map((y, i) => (
              <li key={y.year}>
                <p>
                  <span className="text-2xl font-semibold">{y.count}</span> <span className="text-sm text-muted">tasks</span>
                </p>
                <div
                  className={cn(
                    "mt-1 flex h-7 items-center rounded px-2 text-xs",
                    i === 0 ? "bg-teal text-white" : i === 1 ? "bg-teal/60 text-white" : "bg-teal/25 text-ink"
                  )}
                  style={{ width: `${Math.max(18, (y.count / maxYear) * 100)}%` }}
                >
                  {y.year}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={card}>
          <div className={cardHead}>
            <h2 className="flex items-center gap-1.5 font-medium">
              Tasks by status
              <span title="All tasks you can see, by current status">
                <Info size={14} className="text-muted" aria-hidden />
              </span>
            </h2>
          </div>
          <div className="p-5">
            <StatusDonut data={slices} total={totalTasks} />
          </div>
        </section>
      </div>

      {/* Recent tasks */}
      <section className={card}>
        <div className={cardHead}>
          <h2 className="font-medium">Recent tasks</h2>
          <Link href="/tasks" className="text-sm text-teal">
            View all
          </Link>
        </div>
        <form action="/tasks" role="search" className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <label className="flex h-9 w-full items-center gap-2 rounded-md border border-line px-3 sm:w-64">
            <Search size={16} className="text-muted" aria-hidden />
            <input name="q" placeholder="Search tasks…" aria-label="Search tasks" className="w-full bg-transparent text-sm outline-none" />
          </label>
          <Link href="/tasks" className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm hover:bg-paper">
            <SlidersHorizontal size={14} aria-hidden />
            Filters
          </Link>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="px-3 py-3 font-medium">Assignee</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-3 py-3 font-medium">Deadline</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody>
              {(recent.data ?? []).map((task) => {
                const people = ((task.assignments ?? []) as AssigneeRow[]).map((a) => firstOf(a.profile)).filter(Boolean) as {
                  full_name: string;
                  avatar_url: string | null;
                }[];
                const lead = people[0];
                return (
                  <tr key={task.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                    <td className="px-5 py-3">
                      <Link href={`/tasks/${task.id}`} className="hover:text-teal">
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {lead ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={lead.full_name} src={lead.avatar_url} size={28} />
                          <span>
                            {lead.full_name}
                            {people.length > 1 ? <span className="text-muted"> +{people.length - 1}</span> : null}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted">{formatDate(task.created_at)}</td>
                    <td className={cn("px-3 py-3", isOverdue(task) ? "font-medium text-danger" : "text-muted")}>{formatDate(task.due_date)}</td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-line" aria-hidden>
                          <span className="block h-full bg-ink" style={{ width: `${task.progress}%` }} />
                        </span>
                        <span className="font-mono text-xs text-muted">{task.progress}%</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!recent.data?.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    No tasks yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
