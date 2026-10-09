"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, MessageSquare, MoreHorizontal, PlusCircle } from "lucide-react";
import { updateTaskStatus } from "@/lib/actions/tasks";
import { Avatar } from "@/components/ui/avatar";
import { isOverdue, statusLabel } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  progress: number;
  due_date: string | null;
  comments: number;
  people: { full_name: string; avatar_url: string | null }[];
  canMove: boolean;
};

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "completed", label: "Done" },
];

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-muted",
  medium: "bg-gold",
  high: "bg-copper",
  critical: "bg-danger",
};

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));

function ProgressPill({ value }: { value: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const color = value >= 100 ? "var(--ok)" : value >= 50 ? "var(--copper)" : "var(--ink)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </svg>
      {value}%
    </span>
  );
}

export function KanbanBoard({ tasks: initial, canCreate }: { tasks: BoardTask[]; canCreate: boolean }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [, start] = useTransition();

  // Keep in sync when the server sends fresh data (after router.refresh or a new search).
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setTasks(initial);
  }

  function move(id: string, status: TaskStatus) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (!task.canMove) {
      toast.error("Only managers and the task's assignees can move it.");
      return;
    }
    const previous = tasks;
    setTasks((all) =>
      all.map((t) => (t.id === id ? { ...t, status, progress: status === "completed" ? 100 : t.progress } : t))
    );
    start(async () => {
      const res = await updateTaskStatus(id, status);
      if ("error" in res && res.error) {
        setTasks(previous);
        toast.error(res.error);
      } else {
        toast.success(`Moved to ${statusLabel(status)}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.status);
        return (
          <section
            key={col.status}
            aria-label={col.label}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(col.status);
            }}
            onDragLeave={() => setOver((s) => (s === col.status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragging;
              setOver(null);
              setDragging(null);
              if (id) move(id, col.status);
            }}
            className={cn(
              "flex w-[300px] shrink-0 flex-col rounded-md border bg-line/25 p-2.5 transition-colors",
              over === col.status ? "border-teal bg-teal/5" : "border-transparent"
            )}
          >
            <header className="mb-2.5 flex items-center justify-between px-1.5 pt-1">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                {col.label}
                <span className="rounded-full border border-line bg-panel px-2 text-xs text-muted">{items.length}</span>
              </h2>
              {canCreate ? (
                <Link href="/tasks/new" className="text-muted hover:text-teal" aria-label={`New task in ${col.label}`}>
                  <PlusCircle size={18} />
                </Link>
              ) : null}
            </header>

            <ul className="flex min-h-24 flex-col gap-2.5">
              {items.map((task) => (
                <li
                  key={task.id}
                  draggable={task.canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", task.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(task.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn(
                    "rounded-md border border-line bg-panel p-4 shadow-sm",
                    task.canMove && "cursor-grab active:cursor-grabbing",
                    dragging === task.id && "opacity-50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/tasks/${task.id}`} className="font-medium leading-snug hover:text-teal">
                      {task.title}
                    </Link>
                    {task.canMove ? (
                      <details className="relative shrink-0">
                        <summary
                          className="flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded text-muted hover:bg-paper [&::-webkit-details-marker]:hidden"
                          aria-label="Move task"
                        >
                          <MoreHorizontal size={16} />
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-line bg-panel py-1 text-sm shadow-[var(--shadow)]">
                          <p className="px-3 py-1 text-xs text-muted">Move to</p>
                          {COLUMNS.filter((c) => c.status !== task.status).map((c) => (
                            <button
                              key={c.status}
                              type="button"
                              onClick={(e) => {
                                (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                                move(task.id, c.status);
                              }}
                              className="block w-full px-3 py-1.5 text-left hover:bg-paper"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                  {task.description ? <p className="mt-1.5 line-clamp-2 text-sm text-muted">{task.description}</p> : null}

                  <div className="mt-3 flex items-center justify-between">
                    <span className="flex -space-x-1.5">
                      {task.people.slice(0, 3).map((p) => (
                        <span key={p.full_name} title={p.full_name} className="rounded-sm ring-2 ring-panel">
                          <Avatar name={p.full_name} src={p.avatar_url} size={26} />
                        </span>
                      ))}
                      {task.people.length > 3 ? (
                        <span className="flex h-[26px] items-center rounded-sm bg-paper px-1.5 text-xs text-muted ring-2 ring-panel">
                          +{task.people.length - 3}
                        </span>
                      ) : null}
                      {!task.people.length ? <span className="text-xs text-muted">Unassigned</span> : null}
                    </span>
                    <ProgressPill value={task.progress} />
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 capitalize">
                        <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[task.priority] ?? "bg-muted")} />
                        {task.priority}
                      </span>
                      {task.due_date ? (
                        <span className={cn("inline-flex items-center gap-1", isOverdue(task) ? "font-medium text-danger" : "text-muted")}>
                          <CalendarDays size={13} aria-hidden />
                          {shortDay(task.due_date)}
                        </span>
                      ) : null}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted" title={`${task.comments} comments`}>
                      <MessageSquare size={13} aria-hidden />
                      {task.comments}
                    </span>
                  </div>
                </li>
              ))}
              {!items.length ? (
                <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                  {dragging ? "Drop here" : "No tasks"}
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
