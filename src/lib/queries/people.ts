import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeSearch } from "@/lib/utils";

/**
 * Resolve the directory filters to a list of user ids.
 * Returns null when no filter is active (meaning "everyone").
 * Both the People page and /api/employees go through here so they filter identically.
 */
export async function findPeopleIds(
  supabase: SupabaseClient,
  { q, dept }: { q?: string | null; dept?: string | null }
): Promise<string[] | null> {
  const term = sanitizeSearch(q);
  let ids: Set<string> | null = null;

  if (term) {
    const [byProfile, byEmail] = await Promise.all([
      supabase
        .from("profiles")
        .select("id")
        .or(`full_name.ilike.%${term}%,department.ilike.%${term}%,job_title.ilike.%${term}%`)
        .limit(1000),
      supabase.from("users").select("id").ilike("email", `%${term}%`).limit(1000),
    ]);
    ids = new Set([...(byProfile.data ?? []), ...(byEmail.data ?? [])].map((r) => r.id as string));
  }

  if (dept) {
    const { data } = await supabase.from("profiles").select("id").eq("department", dept).limit(1000);
    const inDept = new Set((data ?? []).map((r) => r.id as string));
    ids = ids ? new Set([...ids].filter((id) => inDept.has(id))) : inDept;
  }

  return ids ? [...ids] : null;
}

/** Active people who can be assigned work, sorted by name. */
export async function listAssignablePeople(supabase: SupabaseClient) {
  const { data } = await supabase.from("users").select("id, profile:profiles(full_name)").neq("status", "inactive");
  return (data ?? [])
    .map((u) => {
      const profile = Array.isArray(u.profile) ? u.profile[0] : u.profile;
      return { id: u.id as string, name: (profile?.full_name as string | undefined) ?? "Unnamed" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
