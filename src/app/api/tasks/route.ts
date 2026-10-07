import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePage, sanitizeSearch } from "@/lib/utils";

const status = z.enum(["todo", "in_progress", "blocked", "completed", "cancelled"]);
const priority = z.enum(["low", "medium", "high", "critical"]);

// RLS decides which tasks the caller may see: employees get their own, managers and admins get all.
export async function GET(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = parsePage(searchParams.get("page") ?? undefined);
  const pageSize = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "25", 10) || 25, 1), 100);

  const supabase = await createClient();
  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, progress, due_date, completed_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  const s = status.safeParse(searchParams.get("status"));
  if (s.success) query = query.eq("status", s.data);
  const p = priority.safeParse(searchParams.get("priority"));
  if (p.success) query = query.eq("priority", p.data);
  const q = sanitizeSearch(searchParams.get("q"));
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);

  const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data, page, pageSize, total: count ?? 0 });
}
