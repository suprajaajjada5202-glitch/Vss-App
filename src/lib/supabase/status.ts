import { createClient } from "@/lib/supabase/server";
import { isSchemaMissing } from "@/lib/supabase/errors";
import { supabaseUrlProblem } from "@/lib/supabase/config";

export type DatabaseStatus =
  | { state: "ready" }
  | { state: "missing" } // keys work, supabase/schema.sql has not been run
  | { state: "error"; message: string };

/** One cheap anonymous query: does the app's schema exist, and are the URL and keys usable? */
export async function checkDatabase(): Promise<DatabaseStatus> {
  const urlProblem = supabaseUrlProblem();
  if (urlProblem) return { state: "error", message: urlProblem };
  try {
    const supabase = await createClient();
    // `roles` is readable only when signed in, so anonymous callers get an empty list rather than an
    // error when the table exists — which is all this check needs.
    const { error } = await supabase.from("roles").select("name").limit(1);
    if (!error) return { state: "ready" };
    if (isSchemaMissing(error)) return { state: "missing" };
    return { state: "error", message: error.message || "Supabase returned an unexpected error." };
  } catch (error) {
    return { state: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Whether anyone can self-register on the Supabase project. This app creates accounts from the admin
 * screen only, so open sign-ups would let strangers into the staff directory. Cached for 10 minutes.
 */
export async function publicSignupsEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false; // unknown is not an alarm
    const settings = (await res.json()) as { disable_signup?: boolean; external?: { email?: boolean } };
    return settings.disable_signup === false && settings.external?.email !== false;
  } catch {
    return false;
  }
}

export async function signupsWarningFor(role: string) {
  return role === "admin" || role === "super_admin" ? publicSignupsEnabled() : false;
}
