import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS, canManageEmployees } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { firstOf, formatDate } from "@/lib/utils";
import type { RoleName } from "@/lib/types";
import { DeleteEmployeeButton } from "@/components/employees/delete-button";
import { MessageButton } from "@/components/employees/message-button";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select(
      "id, email, status, created_at, role:roles(name), profile:profiles(*), employee:employees(*, manager:manager_id(user:users(profile:profiles(full_name))))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const profile = Array.isArray(data.profile) ? data.profile[0] : data.profile;
  const role = Array.isArray(data.role) ? data.role[0] : data.role;
  const employee = Array.isArray(data.employee) ? data.employee[0] : data.employee;

  const { data: assigned } = await supabase
    .from("task_assignments")
    .select("task:tasks(id, title, status, priority)")
    .eq("user_id", id)
    .limit(12);

  return (
    <div>
      <PageHeader
        kicker={employee?.employee_code}
        title={profile?.full_name ?? data.email}
        description={profile?.job_title ?? "No title on file"}
        actions={
          <>
            {me.id !== id ? <MessageButton userId={id} /> : null}
            {canManageEmployees(me.role) && (role?.name !== "super_admin" || me.role === "super_admin") ? (
              <>
                <Link href={`/employees/${id}/edit`} className="inline-flex h-10 items-center border border-line px-4 text-sm hover:bg-paper">
                  Edit
                </Link>
                {me.id !== id ? <DeleteEmployeeButton userId={id} name={profile?.full_name} /> : null}
              </>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="bg-panel p-5">
          <Avatar name={profile?.full_name ?? data.email} src={profile?.avatar_url} size={72} />
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-muted">Email</dt>
              <dd>{data.email}</dd>
            </div>
            <div>
              <dt className="text-muted">Phone</dt>
              <dd>{profile?.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Desk</dt>
              <dd>{profile?.department ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Location</dt>
              <dd>{profile?.location ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Role</dt>
              <dd>
                <Badge>{ROLE_LABELS[(role?.name as RoleName) ?? "employee"]}</Badge>
                {data.status !== "active" ? (
                  <span className="ml-2">
                    <Badge tone={data.status === "inactive" ? "danger" : "muted"}>{data.status.replace("_", " ")}</Badge>
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Reports to</dt>
              <dd>{firstOf(firstOf(firstOf(employee?.manager)?.user)?.profile)?.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Joined</dt>
              <dd>{formatDate(employee?.hire_date ?? data.created_at)}</dd>
            </div>
          </dl>
        </aside>
        <section className="space-y-6">
          <div className="bg-panel p-5">
            <h2 className="mb-2 text-lg font-medium">Notes</h2>
            <p className="text-sm text-muted">{profile?.bio ?? "No bio yet."}</p>
            <p className="mt-3 text-sm">
              Skills: {(employee?.skills ?? []).join(", ") || "—"}
            </p>
          </div>
          <div className="bg-panel p-5">
            <h2 className="mb-3 text-lg font-medium">Assigned work</h2>
            <ul className="space-y-2 text-sm">
              {(assigned ?? []).map((row) => {
                const task = Array.isArray(row.task) ? row.task[0] : row.task;
                if (!task) return null;
                return (
                  <li key={task.id}>
                    <Link href={`/tasks/${task.id}`} className="hover:text-teal">
                      {task.title}
                    </Link>
                    <span className="ml-2 text-muted">{task.status.replace("_", " ")}</span>
                  </li>
                );
              })}
              {!assigned?.length ? <p className="text-muted">No assignments.</p> : null}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
