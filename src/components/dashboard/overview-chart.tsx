"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

export type DayPoint = { date: string; created: number; completed: number };

const RANGES = [
  { days: 90, label: "Last 3 months" },
  { days: 30, label: "Last 30 days" },
  { days: 7, label: "Last 7 days" },
] as const;

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));

/** Daily tasks created vs completed. `data` holds the last 90 days, oldest first. */
export function OverviewChart({ data }: { data: DayPoint[] }) {
  const [days, setDays] = useState<number>(90);
  const range = RANGES.find((r) => r.days === days) ?? RANGES[0];
  const points = data.slice(-days);
  const created = points.reduce((sum, p) => sum + p.created, 0);
  const completed = points.reduce((sum, p) => sum + p.completed, 0);

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Tasks overview</h2>
          <p className="text-sm text-muted">
            {created} created · {completed} completed in the {range.label.toLowerCase()}
          </p>
        </div>
        <div className="inline-flex w-fit rounded-md border border-line text-sm" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={r.days === days}
              className={cn(
                "border-l border-line px-3 py-1.5 first:rounded-l-md first:border-l-0 last:rounded-r-md",
                r.days === days ? "bg-paper font-medium" : "text-muted hover:text-ink"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72 w-full px-2 py-4" role="img" aria-label={`Tasks created and completed per day, ${range.label.toLowerCase()}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fill-completed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fill-created" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--muted)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--muted)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              minTickGap={28}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis allowDecimals={false} width={32} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              labelFormatter={(label) => dayLabel(String(label))}
              contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }}
            />
            <Area type="monotone" dataKey="created" name="Created" stroke="var(--muted)" strokeOpacity={0.5} fill="url(#fill-created)" />
            <Area type="monotone" dataKey="completed" name="Completed" stroke="var(--teal)" strokeWidth={2} fill="url(#fill-completed)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
