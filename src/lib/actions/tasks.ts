"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sendEmailBatch, taskAssignedEmail, taskStatusEmail, type Email } from "@/lib/email";
import { canCreateTasks, canDeleteTasks } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/utils";

const TASK_STATUSES = ["todo", "in_progress", "blocked", "completed", "cancelled"] as const;
const uuid = z.string().uuid();

const taskSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid due date")]).optional(),
  assigneeIds: z.string().optional(),
});

function parseAssignees(raw?: string) {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids.filter((id) => uuid.safeParse(id).success)));
}

function refreshTaskPages(taskId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

async function mailAssignees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userIds: string[],
  title: string,
  taskId: string
) {
  if (!userIds.length) return;
  const { data: people } = await supabase
    .from("users")
    .select("email, profile:profiles(full_name)")
    .in("id", userIds);
  const messages: Email[] = (people ?? []).map((person) => ({
    to: person.email,
    ...taskAssignedEmail(firstOf(person.profile)?.full_name ?? "there", title, taskId),
  }));
  await sendEmailBatch(messages);
}

export async function createTask(formData: FormData) {
  const user = await requireUser();
  if (!canCreateTasks(user.role)) return { error: "Managers and admins can create tasks." };

  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid task" };
  const input = parsed.data;
  const ids = parseAssignees(input.assigneeIds);

  const supabase = await createClient();
  // Check assignees first: managers cannot delete a half-created task if assigning fails later.
  if (ids.length) {
    const { data: found } = await supabase.from("profiles").select("id").in("id", ids);
    if ((found?.length ?? 0) !== ids.length) return { error: "One or more selected people no longer exist." };
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      due_date: input.dueDate || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !task) return { error: error?.message ?? "Could not create task" };

  if (ids.length) {
    const { error: assignError } = await supabase
      .from("task_assignments")
      .insert(ids.map((user_id) => ({ task_id: task.id, user_id, assigned_by: user.id })));
    if (assignError) {
      revalidatePath("/tasks");
      return { error: `The task was created, but assigning it failed: ${assignError.message}`, id: task.id };
    }
    await mailAssignees(supabase, ids.filter((id) => id !== user.id), input.title, task.id);
  }

  await supabase.from("activity_logs").insert({
    actor_id: user.id,
    action: "task_created",
    entity_type: "task",
    entity_id: task.id,
    metadata: { title: input.title },
  });

  refreshTaskPages();
  return { ok: true as const, id: task.id };
}

export async function updateTask(taskId: string, formData: FormData) {
  const user = await requireUser();
  if (!canCreateTasks(user.role)) return { error: "Managers and admins can edit tasks." };
  if (!uuid.safeParse(taskId).success) return { error: "Invalid task" };

  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid task" };
  const input = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      due_date: input.dueDate || null,
    })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "Task not found or you do not have access." };

  // Reconcile assignees.
  const wanted = new Set(parseAssignees(input.assigneeIds));
  const { data: current } = await supabase.from("task_assignments").select("user_id").eq("task_id", taskId);
  const have = new Set((current ?? []).map((row) => row.user_id as string));
  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.has(id));

  if (toAdd.length) {
    const { error: addError } = await supabase
      .from("task_assignments")
      .insert(toAdd.map((user_id) => ({ task_id: taskId, user_id, assigned_by: user.id })));
    if (addError) return { error: `Could not add assignees: ${addError.message}` };
  }
  if (toRemove.length) {
    const { error: removeError } = await supabase
      .from("task_assignments")
      .delete()
      .eq("task_id", taskId)
      .in("user_id", toRemove);
    if (removeError) return { error: `Could not remove assignees: ${removeError.message}` };
  }
  await mailAssignees(supabase, toAdd.filter((id) => id !== user.id), input.title, taskId);

  await supabase.from("activity_logs").insert({
    actor_id: user.id,
    action: "task_updated",
    entity_type: "task",
    entity_id: taskId,
    metadata: { title: input.title },
  });

  refreshTaskPages(taskId);
  return { ok: true as const, id: taskId };
}

const statusSchema = z.object({
  taskId: uuid,
  status: z.enum(TASK_STATUSES),
  progress: z.number().int().min(0).max(100).optional(),
});

export async function updateTaskStatus(taskId: string, status: string, progress?: number) {
  const user = await requireUser();
  const parsed = statusSchema.safeParse({ taskId, status, progress });
  if (!parsed.success) return { error: "Invalid status or progress" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("tasks")
    .select("title, status, created_by")
    .eq("id", taskId)
    .maybeSingle();
  if (!before) return { error: "Task not found or you do not have access." };

  const patch: { status: string; progress?: number } = { status: parsed.data.status };
  if (typeof parsed.data.progress === "number") patch.progress = parsed.data.progress;

  // RLS + trigger enforce who may do this; select() tells us whether a row was actually updated.
  const { data: updated, error } = await supabase.from("tasks").update(patch).eq("id", taskId).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "You are not allowed to update this task." };

  await supabase.from("activity_logs").insert({
    actor_id: user.id,
    action: "task_status_updated",
    entity_type: "task",
    entity_id: taskId,
    metadata: { title: before.title, status: parsed.data.status, progress: parsed.data.progress ?? null },
  });

  if (before.status !== parsed.data.status) {
    const { data: assignees } = await supabase.from("task_assignments").select("user_id").eq("task_id", taskId);
    const recipients = new Set((assignees ?? []).map((a) => a.user_id as string));
    if (before.created_by) recipients.add(before.created_by);
    recipients.delete(user.id);

    if (recipients.size) {
      const { data: people } = await supabase
        .from("users")
        .select("email, profile:profiles(full_name)")
        .in("id", [...recipients]);
      const label = parsed.data.status.replace("_", " ");
      await sendEmailBatch(
        (people ?? []).map((p) => ({
          to: p.email,
          ...taskStatusEmail(firstOf(p.profile)?.full_name ?? "there", before.title, label, user.fullName, taskId),
        }))
      );
    }
  }

  refreshTaskPages(taskId);
  return { ok: true as const };
}

export async function addTaskComment(taskId: string, body: string) {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return { error: "Comment cannot be empty" };
  if (text.length > 2000) return { error: "Comment is too long (2000 characters max)" };
  if (!uuid.safeParse(taskId).success) return { error: "Invalid task" };

  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: user.id, body: text });
  if (error) return { error: "You cannot comment on this task." };

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true as const };
}

export async function deleteTask(taskId: string) {
  const user = await requireUser();
  if (!canDeleteTasks(user.role)) return { error: "Only admins can delete tasks." };
  if (!uuid.safeParse(taskId).success) return { error: "Invalid task" };

  const supabase = await createClient();
  const { data: before } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
  const { data: deleted, error } = await supabase.from("tasks").delete().eq("id", taskId).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!deleted) return { error: "Task not found." };

  await supabase.from("activity_logs").insert({
    actor_id: user.id,
    action: "task_deleted",
    entity_type: "task",
    entity_id: taskId,
    metadata: { title: before?.title ?? null },
  });

  refreshTaskPages();
  return { ok: true as const };
}
