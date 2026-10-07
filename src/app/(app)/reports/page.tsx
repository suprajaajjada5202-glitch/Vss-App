import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canSeeAllReports } from "@/lib/permissions";
import { parseRange, REPORT_RANGES } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Pagination, buildHref } from "@/components/ui/pagination";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { WorkChart } from "@/components/dashboard/work-chart";
import { TASK_STATUSES, completedLate, statusLabel } from "@/lib/tasks";
import { cn, firstOf, formatDate, pageCount, parsePage } from "@/lib/utils";

export const metadata = { title: "Reports" };

const PAGE_SIZE = 15;

type Performance = {
  user_id: string;
  full_name: string;
  department: string | null;
  assigned: number;
  completed: number;
  on_time: number;
  overdue: number;
  avg_progress: number | null;
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const range = parseRange(params.range);
  const page = parsePage(params.page);
  const manager = canSeeAllReports(user.role);
  const supabase = await createClient();

  // All aggregates run in Postgres under the caller's RLS: managers see the company, employees only themselves.
  let completedQuery = supabase
    .from("tasks")
    .select(
      "id, title, priority, due_date, completed_at, assignments:task_assignments(profile:profiles!task_assignments_user_id_fkey(full_name))",
      { count: "exact" }
    )
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (range.from) completedQuery = completedQuery.gte("completed_at", range.from);

  const [summaryRes, perfRes, statusRes, trendRes, completedRes] = await Promise.all([
    supabase.rpc("report_summary", { p_from: range.from }),
    supabase.rpc("report_performance", { p_from: range.from }),
    supabase.rpc("task_status_counts"),
    supabase.rpc("report_weekly_trend", { p_weeks: 12 }),
    completedQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);

  const summary = ((summaryRes.data ?? [])[0] ?? {}) as Record<string, number | string | null>;
  const completed = Number(summary.completed ?? 0);
  const onTime = Number(summary.on_time ?? 0);
  const overdueNow = Number(summary.overdue ?? 0);
  const avgDays = summary.avg_days === null || summary.avg_days === undefined ? null : Number(summary.avg_days);

  const performance = ((perfRes.data ?? []) as Performance[]).map((p) => ({
    ...p,
    assigned: Number(p.assigned),
    completed: Number(p.completed),
    on_time: Number(p.on_time),
    overdue: Number(p.overdue),
  }));

  const counts = new Map(((statusRes.data ?? []) as { status: string; n: number }[]).map((r) => [r.status, Number(r.n)]));
  const statusMix = TASK_STATUSES.map((s) => ({ name: statusLabel(s), value: counts.get(s) ?? 0 }));
  const weekly = ((trendRes.data ?? []) as { week_start: string; created: number; completed: number }[]).map((r) => ({
    week: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(`${r.week_start}T00:00:00`)),
    created: Number(r.created),
    completed: Number(r.completed),
  }));

  // Team productivity = completion rate per department.
  const byDept = new Map<string, { assigned: number; completed: number }>();
  for (const p of performance) {
    const key = p.department?.trim() || "No department";
    const cur = byDept.get(key) ?? { assigned: 0, completed: 0 };
    cur.assigned += p.assigned;
    cur.completed += p.completed;
    byDept.set(key, cur);
  }
  const productivity = [...byDept.entries()]
    .map(([name, v]) => ({ name, value: pct(v.completed, v.assigned), ...v }))
    .sort((a, b) => b.value - a.value);

  const completedRows = completedRes.data ?? [];
  const pages = pageCount(completedRes.count, PAGE_SIZE);
  const hrefFor = (n: number) => buildHref("/reports", { range: range.key === "30" ? undefined : range.key, page: n > 1 ? n : undefined });

  const kpis = [
    { label: "Tasks completed", value: String(completed) },
    { label: "Completed on time", value: completed ? `${pct(onTime, completed)}%` : "—" },
    { label: "Avg. days to complete", value: avgDays === null ? "—" : String(avgDays) },
    { label: "Open and overdue", value: String(overdueNow), danger: overdueNow > 0 },
  ];

  return (
    <div>
      <PageHeader
        kicker="Analytics"
        title="Reports"
        description={
          manager
            ? "Company-wide performance, completion and team productivity."
            : "Your own performance and completed work. Managers see the whole company."
        }
        actions={
          manager ? (
            <a
              href={`/api/reports/completed?range=${range.key}`}
              className="inline-flex h-10 items-center border border-line bg-panel px-4 text-sm hover:bg-paper"
            >
              Export completed tasks (CSV)
            </a>
          ) : null
        }
      />

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Report period">
        {REPORT_RANGES.map((r) => (
          <Link
            key={r.key}
            href={buildHref("/reports", { range: r.key === "30" ? undefined : r.key })}
            aria-current={r.key === range.key ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center border px-3 text-sm",
              r.key === range.key ? "border-teal bg-teal text-white" : "border-line bg-panel hover:bg-paper"
            )}
          >
            {r.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="border-l-[3px] border-l-teal bg-panel px-4 py-4">
            <p className={cn("font-mono text-3xl font-medium", k.danger && "text-danger")}>{k.value}</p>
            <p className="mt-1 text-sm text-muted">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="bg-panel p-5">
          <h2 className="mb-4 text-lg font-medium">Task completion (12 weeks)</h2>
          <TrendChart data={weekly} />
        </section>
        <section className="bg-panel p-5">
          <h2 className="mb-4 text-lg font-medium">All tasks by status</h2>
          <WorkChart data={statusMix} label="Number of tasks in each status" />
        </section>
      </div>

      <section className="mt-6 overflow-x-auto border border-line bg-panel">
        <h2 className="border-b border-line px-4 py-3 text-lg font-medium">Employee performance — {range.label.toLowerCase()}</h2>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-2">Employee</th>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Assigned</th>
              <th className="px-4 py-2">Completed</th>
              <th className="px-4 py-2">Completion</th>
              <th className="px-4 py-2">On time</th>
              <th className="px-4 py-2">Overdue</th>
              <th className="px-4 py-2">Avg. progress</th>
            </tr>
          </thead>
          <tbody>
            {performance.map((row) => (
              <tr key={row.user_id} className="border-t border-line">
                <td className="px-4 py-2">
                  <Link href={`/employees/${row.user_id}`} className="hover:text-teal">
                    {row.full_name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted">{row.department ?? "—"}</td>
                <td className="px-4 py-2 font-mono">{row.assigned}</td>
                <td className="px-4 py-2 font-mono">{row.completed}</td>
                <td className="px-4 py-2 font-mono">{pct(row.completed, row.assigned)}%</td>
                <td className="px-4 py-2 font-mono">{row.completed ? `${pct(row.on_time, row.completed)}%` : "—"}</td>
                <td className={cn("px-4 py-2 font-mono", row.overdue > 0 && "text-danger")}>{row.overdue}</td>
                <td className="px-4 py-2 font-mono">{row.avg_progress === null ? "—" : `${row.avg_progress}%`}</td>
              </tr>
            ))}
            {!performance.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-muted">
                  No assignments in this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {manager ? (
        <section className="mt-6 bg-panel p-5">
          <h2 className="mb-1 text-lg font-medium">Team productivity</h2>
          <p className="mb-4 text-sm text-muted">Share of assigned tasks completed, by department.</p>
          {productivity.length ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <WorkChart
                data={productivity.map(({ name, value }) => ({ name, value }))}
                unit="%"
                label="Completion rate by department"
              />
              <table className="w-full self-start text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2">Department</th>
                    <th className="py-2">Assigned</th>
                    <th className="py-2">Completed</th>
                    <th className="py-2">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {productivity.map((d) => (
                    <tr key={d.name} className="border-t border-line">
                      <td className="py-2">{d.name}</td>
                      <td className="py-2 font-mono">{d.assigned}</td>
                      <td className="py-2 font-mono">{d.completed}</td>
                      <td className="py-2 font-mono">{d.value}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No data for this period.</p>
          )}
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-medium">Completed tasks — {range.label.toLowerCase()}</h2>
        {!completedRows.length ? (
          <EmptyState title="No completed tasks" body="Nothing was completed in this period." />
        ) : (
          <div className="overflow-x-auto border border-line bg-panel">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-paper text-muted">
                <tr>
                  <th className="px-4 py-2">Task</th>
                  <th className="px-4 py-2">Assigned to</th>
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Completed</th>
                  <th className="px-4 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {completedRows.map((t) => {
                  const names = (t.assignments ?? [])
                    .map((a: { profile: unknown }) => firstOf(a.profile as { full_name: string } | { full_name: string }[])?.full_name)
                    .filter(Boolean)
                    .join(", ");
                  const late = completedLate(t);
                  return (
                    <tr key={t.id} className="border-t border-line">
                      <td className="px-4 py-2">
                        <Link href={`/tasks/${t.id}`} className="hover:text-teal">
                          {t.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted">{names || "—"}</td>
                      <td className="px-4 py-2">{t.priority}</td>
                      <td className="px-4 py-2">{formatDate(t.due_date)}</td>
                      <td className="px-4 py-2">{formatDate(t.completed_at)}</td>
                      <td className="px-4 py-2">
                        {t.due_date ? <Badge tone={late ? "danger" : "ok"}>{late ? "late" : "on time"}</Badge> : <span className="text-muted">no due date</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={completedRes.count} hrefFor={hrefFor} />
      </section>
    </div>
  );
}
