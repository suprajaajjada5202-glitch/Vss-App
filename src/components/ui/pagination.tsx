import Link from "next/link";

/** Server-rendered pager. `hrefFor` builds the URL for a page number, keeping the other filters. */
export function Pagination({
  page,
  pages,
  total,
  hrefFor,
}: {
  page: number;
  pages: number;
  total?: number | null;
  hrefFor: (page: number) => string;
}) {
  const link = "inline-flex h-9 items-center border border-line bg-panel px-3 text-sm hover:bg-paper";
  const off = "inline-flex h-9 items-center border border-line px-3 text-sm text-muted opacity-50";
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <p>
        Page {page} of {pages}
        {typeof total === "number" ? ` · ${total} result${total === 1 ? "" : "s"}` : ""}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={link} href={hrefFor(page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={off}>Previous</span>
        )}
        {page < pages ? (
          <Link className={link} href={hrefFor(page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span className={off}>Next</span>
        )}
      </div>
    </nav>
  );
}

/** Build `/path?a=1&b=2` from the defined, non-empty entries of `params`. */
export function buildHref(path: string, params: Record<string, string | number | undefined | null>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `${path}?${text}` : path;
}
