import { cache } from "react";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { isSchemaMissing } from "@/lib/supabase/errors";
import { firstOf } from "@/lib/utils";
import type { RoleName, SessionUser, UserStatus } from "@/lib/types";

type Session = {
  /** A valid Supabase Auth session exists. */
  authenticated: boolean;
  /** The matching public.users row, if any. */
  user: SessionUser | null;
  /** The project's database has not been set up (supabase/schema.sql not run). */
  schemaMissing?: boolean;
};

// One lookup per request: the layout and the page both ask for the user.
const loadSession = cache(async (): Promise<Session> => {
  if (!isSupabaseConfigured()) return { authenticated: false, user: null };
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { authenticated: false, user: null };

  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, status, role:roles(name, permissions), profile:profiles(full_name, avatar_url, job_title, department), employee:employees(employee_code)"
    )
    .eq("id", authUser.id)
    .maybeSingle();

  if (isSchemaMissing(error)) return { authenticated: true, user: null, schemaMissing: true };
  if (!data) return { authenticated: true, user: null };

  const role = firstOf(data.role);
  const profile = firstOf(data.profile);
  const employee = firstOf(data.employee);

  return {
    authenticated: true,
    user: {
      id: data.id,
      email: data.email,
      status: data.status as UserStatus,
      mustChangePassword: authUser.user_metadata?.must_change_password === true,
      role: (role?.name ?? "employee") as RoleName,
      fullName: profile?.full_name ?? data.email,
      avatarUrl: profile?.avatar_url ?? null,
      jobTitle: profile?.job_title ?? null,
      department: profile?.department ?? null,
      employeeCode: employee?.employee_code ?? null,
      permissions: (role?.permissions ?? {}) as Record<string, string[]>,
    },
  };
});

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await loadSession()).user;
}

/** For route handlers: the signed-in, active user, or null (respond 401). */
export async function getApiUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && user.status !== "inactive" ? user : null;
}

export async function requireUser() {
  if (!isSupabaseConfigured()) redirect("/setup");
  const { authenticated, user, schemaMissing } = await loadSession();
  if (!authenticated) redirect("/login");
  if (schemaMissing) redirect("/setup");
  // Signed in with Supabase Auth but unusable here: sign out instead of bouncing
  // between /login and /dashboard (middleware sends signed-in users away from /login).
  if (!user) redirect("/auth/signout?reason=missing");
  if (user.status === "inactive") redirect("/auth/signout?reason=inactive");
  return user;
}

export async function requireRole(roles: RoleName[]) {
  const user = await requireUser();
  if (user.role !== "super_admin" && !roles.includes(user.role)) {
    redirect("/dashboard");
  }
  return user;
}
