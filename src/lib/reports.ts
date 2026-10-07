export const REPORT_RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

export type ReportRange = (typeof REPORT_RANGES)[number];

export function parseRange(value: string | undefined): ReportRange & { from: string | null } {
  const range = REPORT_RANGES.find((r) => r.key === value) ?? REPORT_RANGES[1];
  const from = range.days ? new Date(Date.now() - range.days * 86_400_000).toISOString() : null;
  return { ...range, from };
}

/** Neutralise spreadsheet formula injection (=, +, -, @) and quote anything awkward. */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
