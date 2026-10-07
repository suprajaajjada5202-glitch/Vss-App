import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { TaskForm } from "@/components/tasks/task-form";
import { listAssignablePeople } from "@/lib/queries/people";

export const metadata = { title: "Edit task" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["super_admin", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: task }, { data: assignments }, people] = await Promise.all([
    supabase.from("tasks").select("id, title, description, priority, due_date").eq("id", id).maybeSingle(),
    supabase.from("task_assignments").select("user_id").eq("task_id", id),
    listAssignablePeople(supabase),
  ]);
  if (!task) notFound();

  return (
    <div>
      <PageHeader kicker="Work" title="Edit task" description="Changes, including reassignment, are recorded in the task history." />
      <div className="max-w-2xl bg-panel p-6">
        <TaskForm
          taskId={id}
          people={people}
          initial={{
            title: task.title,
            description: task.description ?? "",
            priority: task.priority,
            dueDate: task.due_date ?? "",
            assigneeIds: (assignments ?? []).map((a) => a.user_id as string),
          }}
        />
      </div>
    </div>
  );
}
