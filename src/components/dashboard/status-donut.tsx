"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export type Slice = { name: string; value: number; color: string };

export function StatusDonut({ data, total }: { data: Slice[]; total: number }) {
  const visible = data.filter((d) => d.value > 0);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-48 w-48" role="img" aria-label="Tasks by status">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible.length ? visible : [{ name: "No tasks", value: 1, color: "var(--line)" }]}
              dataKey="value"
              nameKey="name"
              innerRadius={44}
              outerRadius={90}
              stroke="var(--panel)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {(visible.length ? visible : [{ color: "var(--line)" }]).map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {visible.length ? (
              <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} />
            ) : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold">{total}</span>
          <span className="text-xs text-muted">Tasks</span>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 capitalize text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
              {d.name}
            </span>
            <span className="font-mono">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
