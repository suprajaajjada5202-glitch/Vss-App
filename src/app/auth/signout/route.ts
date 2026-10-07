import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const REASONS = new Set(["inactive", "missing"]);

// Reached via redirect from requireUser() when a signed-in account cannot use the app.
// Signing out here (a route handler can set cookies) breaks the /login <-> /dashboard bounce.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const reason = searchParams.get("reason") ?? "";

  const supabase = await createClient();
  await supabase.auth.signOut();

  const target = new URL("/login", origin);
  if (REASONS.has(reason)) target.searchParams.set("error", reason);
  return NextResponse.redirect(target);
}
