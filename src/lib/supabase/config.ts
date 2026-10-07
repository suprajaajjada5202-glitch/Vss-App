export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return Boolean(
    url &&
      key &&
      !url.includes("YOUR_PROJECT") &&
      key !== "your_anon_key"
  );
}

/**
 * Catches the common slip of pasting the dashboard address
 * (https://supabase.com/dashboard/project/<ref>) instead of the API URL (https://<ref>.supabase.co).
 * Returns a human-readable fix, or null when the URL looks plausible.
 */
export function supabaseUrlProblem(raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL is not a valid URL.";
  }
  const dashboardRef = url.pathname.match(/\/project\/([a-z0-9]+)/i)?.[1];
  if (url.hostname.endsWith("supabase.com") || url.pathname.includes("/dashboard")) {
    return dashboardRef
      ? `That is the dashboard address. Use the API URL instead: https://${dashboardRef}.supabase.co`
      : "That is the dashboard address. Use the API URL from Project Settings → API (https://<project-ref>.supabase.co).";
  }
  return null;
}

/** `<ref>` for hosted projects (https://<ref>.supabase.co), otherwise null (local / self-hosted). */
export function supabaseProjectRef(raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string | null {
  try {
    const host = new URL(raw).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

/** Deep link into the Supabase dashboard for this project, or null for local / self-hosted setups. */
export function supabaseDashboardLink(path = "") {
  const ref = supabaseProjectRef();
  return ref ? `https://supabase.com/dashboard/project/${ref}${path}` : null;
}
