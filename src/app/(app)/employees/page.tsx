import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS, canManageEmployees } from "@/lib/permissions";
import { findPeopleIds } from "@/lib/queries/people";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Pagination, buildHref } from "@/components/ui/pagination";
import { firstOf, pageCount, parsePage, sanitizeSearch } from "@/lib/utils";
import type { RoleName } from "@/lib/types";

export const metadata = { title: "Employees" };

const PAGE_SIZE = 12;
const ROLE_NAMES = new Set(Object.keys(ROLE_LABELS));

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; dept?: string; role?: string; status?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = sanitizeSearch(params.q);
  const dept = params.dept?.trim() || undefined;
  const role = params.role && ROLE_NAMES.has(params.role) ? params.role : undefined;
  const status = ["active", "inactive", "on_leave"].includes(params.status ?? "") ? params.status : undefined;
  const page = parsePage(params.page);

  const supabase = await createClient();
  const ids = await findPeopleIds(supabase, { q, dept });

  let query = supabase
    .from("users")
    .select(
      "id, email, status, created_at, role:roles(name), profile:profiles(full_name, avatar_url, job_title, department, phone), employee:employees(employee_code, hire_date)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (role) {
    const { data: roleRow } = await supabase.from("roles").select("id").eq("name", role).maybeSingle();
    query = query.eq("role_id", roleRow?.id ?? "00000000-0000-0000-0000-000000000000");
  }
  if (status) query = query.eq("status", status);
  if (ids) query = ids.length ? query.in("id", ids) : query.in("id", ["00000000-0000-0000-0000-000000000000"]);

  const [{ data, count }, { data: deptRows }] = await Promise.all([
    query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("profiles").select("department").not("department", "is", null).limit(1000),
  ]);

  const rows = data ?? [];
  const departments = Array.from(new Set((deptRows ?? []).map((r) => r.department as string).filter(Boolean))).sort();
  const pages = pageCount(count, PAGE_SIZE);
  const hrefFor = (n: number) => buildHref("/employees", { q, dept, role, status, page: n > 1 ? n : undefined });
  const filtered = Boolean(q || dept || role || status);

  const control = "h-10 border border-line bg-panel px-3 text-sm";

  return (
    <div>
      <PageHeader
        kicker="Directory"
        title="Employees"
        description="Everyone with an account. Search by name, email, title or department."
        actions={
          canManageEmployees(user.role) ? (
            <Link href="/employees/new">
              <Button>Add employee</Button>
            </Link>
          ) : null
        }
      />

      <form className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, email, title…" aria-label="Search" className={control} />
        <select name="dept" defaultValue={dept ?? ""} aria-label="Department" className={control}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select name="role" defaultValue={role ?? ""} aria-label="Role" className={control}>
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={control}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="on_leave">On leave</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className="flex gap-2">
          <button className="h-10 flex-1 bg-teal px-4 text-sm text-white hover:bg-teal-deep">Apply</button>
          {filtered ? (
            <Link href="/employees" className="inline-flex h-10 items-center border border-line px-3 text-sm hover:bg-paper">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {!rows.length ? (
        <EmptyState
          title={filtered ? "No matching employees" : "No employees yet"}
          body={filtered ? "Try widening the filters." : "Add the first employee to get started."}
        />
      ) : (
        <div className="overflow-x-auto border border-line bg-panel">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-paper font-medium text-muted">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const profile = firstOf(row.profile);
                const roleName = firstOf(row.role)?.name as RoleName | undefined;
                const employee = firstOf(row.employee);
                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/employees/${row.id}`} className="flex items-center gap-3 hover:text-teal">
                        <Avatar name={profile?.full_name ?? row.email} src={profile?.avatar_url} />
                        <span>
                          <span className="block font-medium">{profile?.full_name ?? "Unnamed"}</span>
                          <span className="text-xs text-muted">{profile?.job_title ?? row.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{profile?.department ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge>{ROLE_LABELS[roleName ?? "employee"]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={row.status === "active" ? "ok" : row.status === "inactive" ? "danger" : "muted"}>
                        {row.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{employee?.employee_code}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pages={pages} total={count} hrefFor={hrefFor} />
    </div>
  );
}
