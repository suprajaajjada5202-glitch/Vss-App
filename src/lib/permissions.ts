import type { RoleName, SessionUser } from "./types";

export const ROLE_LABELS: Record<RoleName, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

export function can(user: SessionUser | null | undefined, resource: string, action: string) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  return user.permissions[resource]?.includes(action) ?? false;
}

export function canManageEmployees(role: RoleName) {
  return role === "super_admin" || role === "admin";
}

export function canCreateTasks(role: RoleName) {
  return role === "super_admin" || role === "admin" || role === "manager";
}

export function canAnnounce(role: RoleName) {
  return role === "super_admin" || role === "admin";
}

export function canSeeAllReports(role: RoleName) {
  return role !== "employee";
}

export function canDeleteTasks(role: RoleName) {
  return role === "super_admin" || role === "admin";
}
