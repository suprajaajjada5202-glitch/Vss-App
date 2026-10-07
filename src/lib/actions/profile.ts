"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(1000, "Bio is limited to 1000 characters").optional(),
  dateOfBirth: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date of birth")]).optional(),
});

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid profile" };
  const input = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone || null,
      job_title: input.jobTitle || null,
      department: input.department || null,
      location: input.location || null,
      bio: input.bio || null,
      date_of_birth: input.dateOfBirth || null,
    })
    .eq("id", user.id);
  if (error) return { error: error.message };

  await supabase.from("notifications").insert({
    user_id: user.id,
    type: "profile_updated",
    title: "Profile updated",
    body: "Your profile details were saved.",
    link: "/profile",
  });

  await supabase.from("activity_logs").insert({
    actor_id: user.id,
    action: "profile_updated",
    entity_type: "profile",
    entity_id: user.id,
    metadata: {},
  });

  return { ok: true as const };
}

/** `path` is the object path inside the avatars bucket, e.g. `<user id>/1700000000-me.png`. */
export async function saveAvatarPath(path: string) {
  const user = await requireUser();
  if (!path.startsWith(`${user.id}/`) || path.includes("..")) return { error: "Invalid file location" };

  const supabase = await createClient();
  const { data: previous } = await supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);

  const { error } = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", user.id);
  if (error) return { error: error.message };

  // Drop the previous photo so the bucket does not accumulate old uploads.
  const marker = "/object/public/avatars/";
  const oldPath = previous?.avatar_url?.split(marker)[1];
  if (oldPath && oldPath !== path && oldPath.startsWith(`${user.id}/`)) {
    await supabase.storage.from("avatars").remove([oldPath]);
  }

  return { ok: true as const, url: data.publicUrl };
}

export async function changePassword(currentPassword: string, nextPassword: string) {
  const user = await requireUser();
  if (nextPassword.length < 8) return { error: "Password must be at least 8 characters." };
  if (nextPassword.length > 72) return { error: "Password must be at most 72 characters." };
  if (nextPassword === currentPassword) return { error: "Choose a password different from the current one." };

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) return { error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({
    password: nextPassword,
    data: { must_change_password: false },
  });
  if (error) return { error: error.message };

  return { ok: true as const };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
