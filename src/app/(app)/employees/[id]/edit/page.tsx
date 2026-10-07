import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { EmployeeForm } from "@/components/employees/employee-form";
import { firstOf } from "@/lib/utils";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["super_admin", "admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, email, status, role:roles(name), profile:profiles(*), employee:employees(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const profile = firstOf(data.profile);
  const role = firstOf(data.role);
  const employee = firstOf(data.employee);
  if (role?.name === "super_admin" && user.role !== "super_admin") notFound();

  const { data: managerRows } = await supabase
    .from("users")
    .select("status, profile:profiles(full_name), employee:employees(id)")
    .neq("status", "inactive");

  const managers = (managerRows ?? [])
    .map((row) => ({
      id: firstOf(row.employee)?.id as string | undefined,
      name: firstOf(row.profile)?.full_name ?? "Unnamed",
    }))
    .filter((m): m is { id: string; name: string } => Boolean(m.id) && m.id !== employee?.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader kicker="Directory" title={`Edit ${profile?.full_name}`} />
      <div className="max-w-3xl bg-panel p-6">
        <EmployeeForm
          userId={id}
          canSuper={user.role === "super_admin"}
          managers={managers}
          defaultValues={{
            email: data.email,
            fullName: profile?.full_name ?? "",
            phone: profile?.phone ?? "",
            jobTitle: profile?.job_title ?? "",
            department: profile?.department ?? "",
            location: profile?.location ?? "",
            roleName: role?.name ?? "employee",
            status: data.status,
            hireDate: employee?.hire_date ?? "",
            employmentType: employee?.employment_type ?? "full_time",
            managerId: employee?.manager_id ?? "",
            skills: (employee?.skills ?? []).join(", "),
          }}
        />
      </div>
    </div>
  );
}
