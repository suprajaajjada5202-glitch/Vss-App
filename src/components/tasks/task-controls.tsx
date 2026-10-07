"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addTaskComment, deleteTask, updateTaskStatus } from "@/lib/actions/tasks";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { TASK_STATUSES, statusLabel } from "@/lib/tasks";
import type { TaskStatus } from "@/lib/types";

export function TaskControls({
  taskId,
  status,
  progress,
  canUpdate,
  canDelete,
}: {
  taskId: string;
  status: TaskStatus;
  progress: number;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const [value, setValue] = useState(progress);
  const latest = useRef(progress);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function save(nextStatus: string, nextProgress?: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    start(async () => {
      const res = await updateTaskStatus(taskId, nextStatus, nextProgress);
      inFlight.current = false;
      if ("error" in res && res.error) toast.error(res.error);
      else toast.success("Task updated");
      router.refresh();
    });
  }

  // Save once the person has finished adjusting: on release (mouse/touch/pen), on blur, or shortly
  // after the last key press. Saving on every key press would interrupt keyboard users mid-adjustment.
  const commitProgress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (latest.current !== progress) save(status, latest.current);
  };
  const commitSoon = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commitProgress, 700);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        <label className="text-sm">
          <span className="text-muted">Status</span>
          <Select
            className="mt-1 min-w-44"
            defaultValue={status}
            disabled={!canUpdate || pending}
            onChange={(e) => save(e.target.value)}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Progress {value}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value}
            disabled={!canUpdate}
            className="mt-2 block w-56 accent-teal"
            onChange={(e) => {
              latest.current = Number(e.target.value);
              setValue(latest.current);
            }}
            onPointerUp={commitProgress}
            onKeyUp={commitSoon}
            onBlur={commitProgress}
          />
        </label>
        {canDelete ? (
          <Button
            variant="danger"
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm("Delete this task, its comments and history? This cannot be undone.")) return;
              start(async () => {
                const res = await deleteTask(taskId);
                if ("error" in res && res.error) toast.error(res.error);
                else {
                  toast.success("Task deleted");
                  router.push("/tasks");
                  router.refresh();
                }
              });
            }}
          >
            Delete task
          </Button>
        ) : null}
      </div>
      {!canUpdate ? <p className="text-sm text-muted">Only assignees and managers can update this task.</p> : null}

      {canUpdate ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await addTaskComment(taskId, comment);
              if ("error" in res && res.error) toast.error(res.error);
              else {
                setComment("");
                router.refresh();
              }
            });
          }}
        >
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment"
            aria-label="Add a comment"
            maxLength={2000}
          />
          <Button type="submit" size="sm" disabled={pending || !comment.trim()}>
            Post comment
          </Button>
        </form>
      ) : null}
    </div>
  );
}
