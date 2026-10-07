import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canCreateTasks, canDeleteTasks } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { Badge, priorityTone, statusTone } from "@/components/ui/badge";
import { completedLate, describeHistory, isOverdue, statusLabel } from "@/lib/tasks";
import { firstOf, formatDate, relativeTime } from "@/lib/utils";
import { TaskControls } from "@/components/tasks/task-controls";
import type { TaskHistory, TaskStatus } from "@/lib/types";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: task } = await supabase
    .from("tasks")
    .select("*, creator:profiles!tasks_created_by_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();

  const [{ data: comments }, { data: history }, { data: assignments }] = await Promise.all([
    supabase
      .from("task_comments")
      .select("id, body, created_at, user_id, profile:profiles!task_comments_user_id_fkey(full_name)")
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("task_history").select("*").eq("task_id", id).order("created_at", { ascending: false }).limit(100),
    supabase
      .from("task_assignments")
      .select("user_id, profile:profiles!task_assignments_user_id_fkey(full_name)")
      .eq("task_id", id),
  ]);

  // Names for the people mentioned in the history log (actors and assigned/removed users).
  const historyRows = (history ?? []) as TaskHistory[];
  const wanted = new Set<string>();
  for (const h of historyRows) {
    if (h.user_id) wanted.add(h.user_id);
    const target = (h.details as { user_id?: unknown })?.user_id;
    if (typeof target === "string") wanted.add(target);
  }
  const { data: people } = wanted.size
    ? await supabase.from("profiles").select("id, full_name").in("id", [...wanted])
    : { data: [] as { id: string; full_name: string }[] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));

  const assignees = (assignments ?? []).map((a) => ({
    id: a.user_id as string,
    name: firstOf(a.profile)?.full_name ?? "Unknown",
  }));
  const isAssignee = assignees.some((a) => a.id === me.id);
  const isManager = canCreateTasks(me.role);
  const creator = firstOf(task.creator)?.full_name;
  const overdue = isOverdue(task);

  return (
    <div>
      <PageHeader
        kicker="Task"
        title={task.title}
        description={task.description ?? "No description."}
        actions={
          <>
            <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
            <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
            {overdue ? <Badge tone="danger">overdue</Badge> : null}
            {isManager ? (
              <Link href={`/tasks/${id}/edit`} className="inline-flex h-8 items-center border border-line px-3 text-sm hover:bg-paper">
                Edit
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-panel p-4 text-sm">
          <span className="text-muted">Due</span>
          <p className={`mt-1 font-medium ${overdue ? "text-danger" : ""}`}>{formatDate(task.due_date)}</p>
        </div>
        <div className="bg-panel p-4 text-sm">
          <span className="text-muted">Progress</span>
          <p className="mt-1 font-mono text-xl">{task.progress}%</p>
          <div className="mt-2 h-1.5 bg-paper" role="progressbar" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-teal" style={{ width: `${task.progress}%` }} />
          </div>
        </div>
        <div className="bg-panel p-4 text-sm">
          <span className="text-muted">Assigned to</span>
          <p className="mt-1">{assignees.length ? assignees.map((a) => a.name).join(", ") : "Unassigned"}</p>
        </div>
        <div className="bg-panel p-4 text-sm">
          <span className="text-muted">{task.completed_at ? "Completed" : "Created by"}</span>
          <p className="mt-1">
            {task.completed_at ? (
              <>
                {formatDate(task.completed_at)}{" "}
                {task.due_date ? (
                  <Badge tone={completedLate(task) ? "danger" : "ok"}>{completedLate(task) ? "late" : "on time"}</Badge>
                ) : null}
              </>
            ) : (
              (creator ?? "—")
            )}
          </p>
        </div>
      </div>

      <div className="bg-panel p-5">
        <TaskControls
          key={`${task.status}-${task.progress}`}
          taskId={id}
          status={task.status as TaskStatus}
          progress={task.progress}
          canUpdate={isManager || isAssignee}
          canDelete={canDeleteTasks(me.role)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="bg-panel p-5">
          <h2 className="mb-3 text-lg font-medium">Comments ({comments?.length ?? 0})</h2>
          <ul className="space-y-3">
            {(comments ?? []).map((c) => (
              <li key={c.id} className="border-b border-line pb-3 text-sm last:border-0">
                <p className="font-medium">{firstOf(c.profile)?.full_name ?? "Former employee"}</p>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
                <p className="font-mono text-[11px] text-muted">{relativeTime(c.created_at)}</p>
              </li>
            ))}
            {!comments?.length ? <p className="text-sm text-muted">No comments yet.</p> : null}
          </ul>
        </section>
        <section className="bg-panel p-5">
          <h2 className="mb-3 text-lg font-medium">History</h2>
          <ol className="space-y-3 text-sm">
            {historyRows.map((h) => (
              <li key={h.id} className="border-l-2 border-line pl-3">
                <p>{describeHistory(h, names)}</p>
                <p className="font-mono text-[11px] text-muted">
                  {h.user_id ? (names.get(h.user_id) ?? "Someone") : "System"} · {formatDate(h.created_at, true)}
                </p>
              </li>
            ))}
            {!historyRows.length ? <p className="text-muted">No history recorded.</p> : null}
          </ol>
        </section>
      </div>
    </div>
  );
}
