"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ModelTotal } from "@/lib/types";
import { buildColorMap } from "@/lib/palette";
import { formatCost, formatTokens } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";

export default function ModelBreakdown({
  byModel,
  mode = "tokens",
}: {
  byModel: ModelTotal[];
  /** "tokens" (default) charts each model's share of total tokens; "sessions"
   *  charts each model's share of sessions, for activity-only adapters. */
  mode?: "tokens" | "sessions";
}) {
  const sessionsMode = mode === "sessions";
  const models = byModel.map((m) => m.model);
  const colorMap = buildColorMap(models);
  // Token mode: drop 0-token models so token-less adapters (Antigravity models
  // with all-zero tokens) don't clutter the combined overview donut. Sessions
  // mode: every model with ≥1 session is real, keep all.
  const data = byModel
    .map((m) =>
      sessionsMode
        ? { name: m.model, value: m.sessions, cost: m.cost }
        : { name: m.model, value: m.totalTokens, cost: m.cost },
    )
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const grandTotal = data.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="h-full p-4" hover>
      <CardHeader
        title="By model"
        subtitle={sessionsMode ? "Share of sessions" : "Share of total tokens"}
      />
      {data.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row lg:flex-col">
          <div className="relative h-[200px] w-full sm:w-1/2 lg:w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                  stroke="var(--text)"
                  strokeWidth={3}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={colorMap.get(d.name)} />
                  ))}
                </Pie>
                <Tooltip content={<ModelTooltip sessions={sessionsMode} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="tabular text-xl font-extrabold leading-none"
                style={{ color: "var(--text)" }}
              >
                {sessionsMode ? grandTotal.toLocaleString() : formatTokens(grandTotal)}
              </span>
              <span
                className="mt-1 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {sessionsMode ? "sessions" : "tokens"}
              </span>
            </div>
          </div>
          <div className="flex-1 space-y-2.5">
            {data.map((d) => {
              const pct = grandTotal ? (d.value / grandTotal) * 100 : 0;
              return (
                <div key={d.name} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{
                          background: colorMap.get(d.name),
                          border: "2px solid var(--text)",
                        }}
                      />
                      <span
                        className="truncate font-semibold"
                        style={{ color: "var(--text)" }}
                      >
                        {d.name}
                      </span>
                    </span>
                    <span
                      className="tabular shrink-0 font-extrabold"
                      style={{ color: "var(--text)" }}
                    >
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  {/* Share bar — encodes magnitude without relying on color alone. */}
                  <div
                    className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full"
                    style={{
                      background: "var(--bg-sunken)",
                      border: "2px solid var(--text)",
                    }}
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${pct}%`, background: colorMap.get(d.name) }}
                    />
                  </div>
                  <div
                    className="tabular mt-1 flex justify-between pl-4"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <span>
                      {sessionsMode
                        ? `${d.value.toLocaleString()} sessions`
                        : `${formatTokens(d.value)} tokens`}
                    </span>
                    {!sessionsMode && <span>{formatCost(d.cost)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

interface ModelRow {
  name: string;
  value: number;
  cost: number;
}
function ModelTooltip({
  active,
  payload,
  sessions,
}: {
  active?: boolean;
  payload?: { payload: ModelRow }[];
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
      <div className="tabular" style={{ color: "var(--text-muted)" }}>
        {sessions
          ? `${p.value.toLocaleString()} sessions`
          : `${formatTokens(p.value)} tokens`}
      </div>
      {!sessions && (
        <div className="tabular" style={{ color: "var(--text-muted)" }}>
          {formatCost(p.cost)}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      No model data.
    </div>
  );
}