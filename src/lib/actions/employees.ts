"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { sendTransactionalEmail, welcomeEmail } from "@/lib/email";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/utils";

const optionalText = (max: number) => z.string().trim().max(max).optional();

const employeeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  phone: optionalText(40),
  jobTitle: optionalText(120),
  department: optionalText(120),
  location: optionalText(120),
  roleName: z.enum(["super_admin", "admin", "manager", "employee"]),
  status: z.enum(["active", "inactive", "on_leave"]).default("active"),
  hireDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid hire date")]).optional(),
  employmentType: z.enum(["full_time", "contract", "intern"]).default("full_time"),
  managerId: z.union([z.literal(""), z.string().uuid()]).optional(),
  skills: optionalText(1000),
});

function parseSkills(raw?: string) {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/** A deactivated person must not be able to sign in again or refresh an existing session. */
async function syncBan(userId: string, status: string) {
  const admin = createServiceClient();
  await admin.auth.admin.updateUserById(userId, { ban_duration: status === "inactive" ? "876000h" : "none" });
}

async function targetRole(userId: string) {
  const admin = createServiceClient();
  const { data } = await admin.from("users").select("role:roles(name)").eq("id", userId).maybeSingle();
  return (firstOf(data?.role)?.name as string | undefined) ?? null;
}

export async function createEmployee(formData: FormData) {
  const actor = await requireRole(["super_admin", "admin"]);
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid form" };
  const input = parsed.data;

  if (input.roleName === "super_admin" && actor.role !== "super_admin") {
    return { error: "Only a Super Admin can create another Super Admin." };
  }

  const admin = createServiceClient();
  const { data: role } = await admin.from("roles").select("id").eq("name", input.roleName).single();
  if (!role) return { error: "Role not found" };

  const password = crypto.randomUUID().replaceAll("-", "").slice(0, 12) + "Aa1!";
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, must_change_password: true },
  });
  if (authError || !created.user) {
    return { error: authError?.message ?? "Could not create login" };
  }
  const userId = created.user.id;

  // The auth.users trigger created users/profiles/employees rows; fill them in.
  // If any step fails, remove the login again so the admin can simply retry.
  const steps = await Promise.all([
    admin.from("users").update({ role_id: role.id, status: input.status }).eq("id", userId),
    admin
      .from("profiles")
      .update({
        full_name: input.fullName,
        phone: input.phone || null,
        job_title: input.jobTitle || null,
        department: input.department || null,
        location: input.location || null,
      })
      .eq("id", userId),
    admin
      .from("employees")
      .update({
        hire_date: input.hireDate || null,
        employment_type: input.employmentType,
        manager_id: input.managerId || null,
        skills: parseSkills(input.skills),
      })
      .eq("user_id", userId),
  ]);
  const failed = steps.find((s) => s.error);
  if (failed?.error) {
    await admin.auth.admin.deleteUser(userId);
    return { error: `Could not save the staff record: ${failed.error.message}` };
  }

  if (input.status === "inactive") await syncBan(userId, input.status);

  const app = await createClient();
  await app.from("activity_logs").insert({
    actor_id: actor.id,
    action: "employee_created",
    entity_type: "employee",
    entity_id: userId,
    metadata: { email: input.email, name: input.fullName, role: input.roleName },
  });

  const mail = await sendTransactionalEmail({ to: input.email, ...welcomeEmail(input.fullName, input.email, password) });

  revalidatePath("/employees");
  return {
    ok: true as const,
    userId,
    email: input.email,
    temporaryPassword: password,
    emailed: !mail.skipped && "ok" in mail && mail.ok,
  };
}

export async function updateEmployee(userId: string, formData: FormData) {
  const actor = await requireRole(["super_admin", "admin"]);
  const parsed = employeeSchema.partial({ email: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid form" };
  const input = parsed.data;

  const currentRole = await targetRole(userId);
  if (!currentRole) return { error: "Person not found" };
  if (currentRole === "super_admin" && actor.role !== "super_admin") {
    return { error: "Only a Super Admin can edit a Super Admin." };
  }
  if (input.roleName === "super_admin" && actor.role !== "super_admin") {
    return { error: "Only a Super Admin can assign Super Admin." };
  }
  if (userId === actor.id && (input.roleName !== currentRole || input.status === "inactive")) {
    return { error: "You cannot change your own role or deactivate yourself." };
  }

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id").eq("name", input.roleName).single();
  if (!role) return { error: "Role not found" };

  // Role/status go through the guarded `users` update (RLS + guard_user_changes trigger).
  const userUpdate = await supabase.from("users").update({ role_id: role.id, status: input.status }).eq("id", userId);
  if (userUpdate.error) return { error: userUpdate.error.message };

  const profileUpdate = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone || null,
      job_title: input.jobTitle || null,
      department: input.department || null,
      location: input.location || null,
    })
    .eq("id", userId);
  if (profileUpdate.error) return { error: profileUpdate.error.message };

  if (input.managerId === userId) return { error: "Someone cannot report to themself." };
  const employeeUpdate = await supabase
    .from("employees")
    .update({
      hire_date: input.hireDate || null,
      employment_type: input.employmentType,
      manager_id: input.managerId || null,
      skills: parseSkills(input.skills),
    })
    .eq("user_id", userId);
  if (employeeUpdate.error) return { error: employeeUpdate.error.message };

  await syncBan(userId, input.status);

  await supabase.from("activity_logs").insert({
    actor_id: actor.id,
    action: "employee_updated",
    entity_type: "employee",
    entity_id: userId,
    metadata: { name: input.fullName },
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${userId}`);
  return { ok: true as const };
}

export async function deleteEmployee(userId: string) {
  const actor = await requireRole(["super_admin", "admin"]);
  if (!z.string().uuid().safeParse(userId).success) return { error: "Invalid person" };
  if (actor.id === userId) return { error: "You cannot delete your own account." };

  const role = await targetRole(userId);
  if (!role) return { error: "Person not found" };
  if (role === "super_admin" && actor.role !== "super_admin") {
    return { error: "Only a Super Admin can delete a Super Admin." };
  }

  const admin = createServiceClient();
  const { data: before } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  // Best-effort: remove their profile photos from storage.
  try {
    const { data: files } = await admin.storage.from("avatars").list(userId);
    if (files?.length) await admin.storage.from("avatars").remove(files.map((f) => `${userId}/${f.name}`));
  } catch {
    // orphaned files are harmless
  }

  const supabase = await createClient();
  await supabase.from("activity_logs").insert({
    actor_id: actor.id,
    action: "employee_deleted",
    entity_type: "employee",
    entity_id: userId,
    metadata: { name: before?.full_name ?? null },
  });

  revalidatePath("/employees");
  return { ok: true as const };
}
