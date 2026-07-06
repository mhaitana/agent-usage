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
  metric = "tokens",
}: {
  byProject: ProjectTotal[];
  /** "tokens" (default) ranks projects by token volume; "sessions" ranks by
   *  session count, for activity-only adapters. */
  metric?: "tokens" | "sessions";
}) {
  const sessionsMode = metric === "sessions";
  // Token mode: drop 0-token projects so token-less adapters (Antigravity
  // projects with all-zero tokens) don't displace real ones in the top 12.
  // Sessions mode: rank by sessions, every project with ≥1 session is real.
  const data = byProject
    .slice()
    .filter((p) => (sessionsMode ? p.sessions > 0 : p.totalTokens > 0))
    .sort((a, b) =>
      sessionsMode ? b.sessions - a.sessions : b.totalTokens - a.totalTokens,
    )
    .slice(0, 12)
    .map((p, i) => ({
      name: p.project,
      tokens: p.totalTokens,
      cost: p.cost,
      sessions: p.sessions,
      color: seriesColor(i),
    }));

  const dataKey = sessionsMode ? "sessions" : "tokens";

  return (
    <Card className="p-4" hover>
      <CardHeader
        title="By project"
        subtitle={sessionsMode ? "Top projects by sessions" : "Top projects by tokens"}
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
              tickFormatter={(v) =>
                sessionsMode ? Number(v).toLocaleString() : formatTokens(Number(v))
              }
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={140}
            />
            <Tooltip
              content={<ProjectTooltip sessions={sessionsMode} />}
              cursor={{ fill: "var(--border)", radius: 4 }}
            />
            <Bar
              dataKey={dataKey}
              radius={[0, 4, 4, 0]}
              stroke="var(--text)"
              strokeWidth={2}
              isAnimationActive={false}
              maxBarSize={22}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
              <LabelList
                dataKey={dataKey}
                position="right"
                formatter={(v: unknown) =>
                  sessionsMode ? Number(v).toLocaleString() : formatTokens(Number(v))
                }
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
  sessions,
}: {
  active?: boolean;
  payload?: { payload: ProjectRow }[];
  sessions: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="text-xs"
      style={{
        background: "var(--bg)",
        border: "3px solid var(--text)",
        borderRadius: "var(--radius-card)",
        boxShadow: "5px 5px 0 var(--shadow-hard)",
        padding: "12px",
      }}
    >
      <div className="font-bold" style={{ color: "var(--text)" }}>
        {p.name}
      </div>
      {!sessions && (
        <div className="tabular" style={{ color: "var(--text-muted)" }}>
          {formatTokens(p.tokens)} tokens · {formatCost(p.cost)}
        </div>
      )}
      <div className="tabular" style={{ color: "var(--text-muted)" }}>
        {p.sessions} session{p.sessions === 1 ? "" : "s"}
      </div>
    </div>
  );
}