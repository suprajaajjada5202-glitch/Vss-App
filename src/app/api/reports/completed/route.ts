import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { canSeeAllReports } from "@/lib/permissions";
import { csvCell, parseRange } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { firstOf } from "@/lib/utils";

// Completed-task report as CSV. Managers and above only.
export async function GET(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeeAllReports(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const range = parseRange(new URL(request.url).searchParams.get("range") ?? undefined);
  const supabase = await createClient();

  const rows: string[] = [
    ["Title", "Priority", "Assignees", "Created", "Due", "Completed", "On time"].map(csvCell).join(","),
  ];

  // PostgREST returns at most 1000 rows per request; page through the result.
  for (let offset = 0; offset < 20_000; offset += 1000) {
    let query = supabase
      .from("tasks")
      .select(
        "title, priority, due_date, created_at, completed_at, assignments:task_assignments(profile:profiles!task_assignments_user_id_fkey(full_name))"
      )
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .range(offset, offset + 999);
    if (range.from) query = query.gte("completed_at", range.from);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    for (const t of data ?? []) {
      const names = (t.assignments ?? [])
        .map((a: { profile: unknown }) => firstOf(a.profile as { full_name: string } | { full_name: string }[])?.full_name)
        .filter(Boolean)
        .join("; ");
      const onTime = !t.due_date || (t.completed_at && t.completed_at.slice(0, 10) <= t.due_date);
      rows.push(
        [t.title, t.priority, names, t.created_at?.slice(0, 10), t.due_date, t.completed_at?.slice(0, 10), onTime ? "yes" : "no"]
          .map(csvCell)
          .join(",")
      );
    }
    if ((data?.length ?? 0) < 1000) break;
  }

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="completed-tasks-${range.key}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
