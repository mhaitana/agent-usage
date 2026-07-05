"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProjectTotal } from "@/lib/types";
import { seriesColor } from "@/lib/palette";
import { formatCost, formatTokens } from "@/lib/format";

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
    <Frame title="By project" subtitle="Top projects by tokens">
      {data.length === 0 ? (
        <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No project data.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 28)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
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
              width={120}
            />
            <Tooltip content={<ProjectTooltip />} cursor={{ fill: "var(--gridline)" }} />
            <Bar dataKey="tokens" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Frame>
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
      className="rounded-md border p-2 text-xs shadow-sm"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-ring)" }}
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

function Frame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-ring)" }}
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        {subtitle && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}