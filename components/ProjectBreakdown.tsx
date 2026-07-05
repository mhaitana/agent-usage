"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import type { ProjectTotal } from "@/lib/types";
import { seriesColor } from "@/lib/palette";
import { formatCost, formatTokens } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";

export default function ProjectBreakdown({
  byProject,
}: {
  byProject: ProjectTotal[];
}) {
  const data = byProject
    .slice()
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 12)
    .map((p, i) => ({
      name: p.project,
      tokens: p.totalTokens,
      cost: p.cost,
      sessions: p.sessions,
      color: seriesColor(i),
    }));

  return (
    <Card className="p-4" hover>
      <CardHeader
        title="By project"
        subtitle="Top projects by tokens"
        action={
          data.length > 0 ? (
            <span className="tabular" style={{ color: "var(--text-muted)" }}>
              {data.length} shown
            </span>
          ) : undefined
        }
      />
      {data.length === 0 ? (
        <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No project data.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 32)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 56, top: 0, bottom: 0 }}>
            <XAxis
              type="number"
              tickFormatter={(v) => formatTokens(Number(v))}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={140}
            />
            <Tooltip content={<ProjectTooltip />} cursor={{ fill: "var(--gridline)", radius: 4 }} />
            <Bar dataKey="tokens" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={22}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
              <LabelList
                dataKey="tokens"
                position="right"
                formatter={(v: unknown) => formatTokens(Number(v))}
                style={{ fill: "var(--text-muted)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

interface ProjectRow {
  name: string;
  tokens: number;
  cost: number;
  sessions: number;
}
function ProjectTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ProjectRow }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-lg border p-2.5 text-xs shadow-[var(--shadow-lg)]"
      style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)" }}
    >
      <div className="font-medium" style={{ color: "var(--text-primary)" }}>
        {p.name}
      </div>
      <div className="tabular" style={{ color: "var(--text-secondary)" }}>
        {formatTokens(p.tokens)} tokens · {formatCost(p.cost)}
      </div>
      <div className="tabular" style={{ color: "var(--text-muted)" }}>
        {p.sessions} session{p.sessions === 1 ? "" : "s"}
      </div>
    </div>
  );
}