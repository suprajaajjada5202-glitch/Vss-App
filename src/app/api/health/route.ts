import { NextResponse } from "next/server";

export async function GET() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return NextResponse.json({ ok: true, supabase: configured, name: "VSS Pulse" });
}
