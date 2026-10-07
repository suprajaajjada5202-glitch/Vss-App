import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Pagination, buildHref } from "@/components/ui/pagination";
import { activityLink, describeActivity } from "@/lib/activity";
import { canSeeAllReports } from "@/lib/permissions";
import { firstOf, formatDate, pageCount, parsePage } from "@/lib/utils";

export const metadata = { title: "Activity log" };

const PAGE_SIZE = 25;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const page = parsePage((await searchParams).page);
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("activity_logs")
    .select(
      "id, action, entity_type, entity_id, metadata, created_at, actor:profiles!activity_logs_actor_id_fkey(full_name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const pages = pageCount(count, PAGE_SIZE);

  return (
    <div>
      <PageHeader
        kicker="Audit trail"
        title="Activity log"
        description={
          canSeeAllReports(user.role)
            ? "Who changed what, and when. Role and status changes are recorded by the database itself."
            : "Your own recent actions."
        }
      />
      {!data?.length ? (
        <EmptyState title="No activity yet" body="Actions such as creating tasks or updating profiles will appear here." />
      ) : (
        <div className="overflow-x-auto border border-line bg-panel">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-paper text-muted">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">What</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const href = activityLink(row);
                const text = describeActivity(row);
                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{formatDate(row.created_at, true)}</td>
                    <td className="px-4 py-2">{firstOf(row.actor)?.full_name ?? "System"}</td>
                    <td className="px-4 py-2">
                      {href ? (
                        <Link href={href} className="hover:text-teal">
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} total={count} hrefFor={(n) => buildHref("/activity", { page: n > 1 ? n : undefined })} />
    </div>
  );
}
