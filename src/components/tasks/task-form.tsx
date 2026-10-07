"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createTask, updateTask } from "@/lib/actions/tasks";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { TASK_PRIORITIES } from "@/lib/tasks";

type Initial = {
  title: string;
  description: string;
  priority: string;
  dueDate: string;
  assigneeIds: string[];
};

export function TaskForm({
  people,
  taskId,
  initial,
}: {
  people: { id: string; name: string }[];
  taskId?: string;
  initial?: Initial;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initial?.assigneeIds ?? []);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const isEdit = Boolean(taskId);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("assigneeIds", selected.join(","));
    setError(null);
    start(async () => {
      const res = taskId ? await updateTask(taskId, form) : await createTask(form);
      if ("error" in res && res.error) {
        setError(res.error);
        if ("id" in res && res.id) router.push(`/tasks/${res.id}`); // created, but assignment failed
        return;
      }
      if ("id" in res && res.id) {
        toast.success(isEdit ? "Task updated" : "Task created");
        router.push(`/tasks/${res.id}`);
        router.refresh();
      }
    });
  }

  const shown = people.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Title" htmlFor="title">
        <Input id="title" name="title" required minLength={3} maxLength={200} defaultValue={initial?.title} />
      </Field>
      <Field label="Description" htmlFor="description">
        <Textarea id="description" name="description" maxLength={5000} defaultValue={initial?.description} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={initial?.priority ?? "medium"}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={initial?.dueDate} />
        </Field>
      </div>
      <Field label={`Assign to (${selected.length} selected)`} htmlFor="assignee-filter">
        <Input
          id="assignee-filter"
          className="mb-2"
          placeholder="Filter people"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-auto border border-line p-3 sm:grid-cols-2">
          {shown.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() =>
                  setSelected((cur) => (cur.includes(p.id) ? cur.filter((id) => id !== p.id) : [...cur, p.id]))
                }
              />
              {p.name}
            </label>
          ))}
          {!shown.length ? <p className="text-sm text-muted">No one matches.</p> : null}
        </div>
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create task"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
