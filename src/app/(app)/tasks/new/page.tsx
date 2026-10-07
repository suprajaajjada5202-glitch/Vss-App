import { requireRole } from "@/lib/auth";
import { listAssignablePeople } from "@/lib/queries/people";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { TaskForm } from "@/components/tasks/task-form";

export const metadata = { title: "New task" };

export default async function NewTaskPage() {
  await requireRole(["super_admin", "admin", "manager"]);
  const people = await listAssignablePeople(await createClient());
  return (
    <div>
      <PageHeader
        kicker="Work"
        title="New task"
        description="Assign one or more people. They are notified in the app, and by email when email is configured."
      />
      <div className="max-w-2xl bg-panel p-6">
        <TaskForm people={people} />
      </div>
    </div>
  );
}
