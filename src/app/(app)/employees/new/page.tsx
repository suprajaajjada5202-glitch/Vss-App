import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { EmployeeForm } from "@/components/employees/employee-form";
import { firstOf } from "@/lib/utils";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requireRole(["super_admin", "admin"]);
  const supabase = await createClient();
  const { data: managerRows } = await supabase
    .from("users")
    .select("status, profile:profiles(full_name), employee:employees(id)")
    .neq("status", "inactive");

  const managers = (managerRows ?? [])
    .map((row) => ({
      id: firstOf(row.employee)?.id as string | undefined,
      name: firstOf(row.profile)?.full_name ?? "Unnamed",
    }))
    .filter((m): m is { id: string; name: string } => Boolean(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        kicker="Directory"
        title="Add employee"
        description="Creates a login and an employee record. A temporary password is generated; the person must change it at first sign-in."
      />
      <div className="max-w-3xl bg-panel p-6">
        <EmployeeForm managers={managers} canSuper={user.role === "super_admin"} />
      </div>
    </div>
  );
}
