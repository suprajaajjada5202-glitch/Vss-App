import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { checkDatabase } from "@/lib/supabase/status";

export const dynamic = "force-dynamic";

// First stop for a fresh deployment: send people to the setup checklist until the database exists.
export default async function Home() {
  if (!isSupabaseConfigured()) redirect("/setup");
  const status = await checkDatabase();
  redirect(status.state === "ready" ? "/dashboard" : "/setup");
}
