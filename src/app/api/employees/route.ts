import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { findPeopleIds } from "@/lib/queries/people";
import { createClient } from "@/lib/supabase/server";
import { parsePage } from "@/lib/utils";

export async function GET(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = parsePage(searchParams.get("page") ?? undefined);
  const pageSize = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "25", 10) || 25, 1), 100);

  const supabase = await createClient();
  const ids = await findPeopleIds(supabase, { q: searchParams.get("q"), dept: searchParams.get("dept") });
  if (ids && !ids.length) return NextResponse.json({ data: [], page, pageSize, total: 0 });

  let query = supabase
    .from("users")
    .select(
      "id, email, status, role:roles(name), profile:profiles(full_name, department, job_title, avatar_url)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });
  if (ids) query = query.in("id", ids);

  const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data, page, pageSize, total: count ?? 0 });
}
