"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { announcementEmail, sendEmailBatch } from "@/lib/email";
import { canAnnounce } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/utils";

const ANNOUNCEMENTS = "00000000-0000-0000-0000-000000000001";
const uuid = z.string().uuid();

// Membership is only ever written by SECURITY DEFINER functions (see supabase/schema.sql),
// so a client cannot add itself to someone else's room.

export async function ensureDirectChat(otherUserId: string) {
  await requireUser();
  if (!uuid.safeParse(otherUserId).success) return { error: "Pick someone to message" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_direct_chat", { p_other: otherUserId });
  if (error || !data) return { error: error?.message ?? "Could not open the conversation" };
  return { ok: true as const, chatId: data as string };
}

export async function createGroupChat(name: string, memberIds: string[]) {
  await requireUser();
  const title = name.trim();
  if (!title) return { error: "Give the group a name" };
  if (title.length > 80) return { error: "Group name is too long (80 characters max)" };
  const members = memberIds.filter((id) => uuid.safeParse(id).success);
  if (!members.length) return { error: "Add at least one other person" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_group_chat", { p_name: title, p_members: members });
  if (error || !data) return { error: error?.message ?? "Could not create the group" };
  return { ok: true as const, chatId: data as string };
}

export async function sendAnnouncement(body: string, options: { email?: boolean } = {}) {
  const user = await requireUser();
  if (!canAnnounce(user.role)) return { error: "Only admins can post announcements." };
  const text = body.trim();
  if (!text) return { error: "Write something first" };
  if (text.length > 4000) return { error: "Announcement is too long (4000 characters max)" };

  const supabase = await createClient();
  const { error } = await supabase.from("chat_messages").insert({
    chat_id: ANNOUNCEMENTS,
    sender_id: user.id,
    body: text,
  });
  if (error) return { error: error.message };

  let emailed = 0;
  if (options.email) {
    const { data: people } = await supabase
      .from("users")
      .select("id, email, profile:profiles(full_name)")
      .neq("status", "inactive")
      .neq("id", user.id);
    const result = await sendEmailBatch(
      (people ?? []).map((p) => ({
        to: p.email,
        ...announcementEmail(firstOf(p.profile)?.full_name ?? "there", user.fullName, text),
      }))
    );
    emailed = result.skipped ? 0 : result.sent;
  }
  return { ok: true as const, emailed };
}
