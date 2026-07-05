"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ModelTotal } from "@/lib/types";
import { buildColorMap } from "@/lib/palette";
import { formatCost, formatTokens } from "@/lib/format";

export default function ModelBreakdown({ byModel }: { byModel: ModelTotal[] }) {
  const models = byModel.map((m) => m.model);
  const colorMap = buildColorMap(models);
  const data = byModel.map((m) => ({ name: m.model, tokens: m.totalTokens, cost: m.cost }));
  const grandTotal = data.reduce((s, d) => s + d.tokens, 0);

  return (
    <Frame title="By model" subtitle="Share of total tokens">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative h-[200px] w-full sm:w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="tokens"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={colorMap.get(d.name)} />
                  ))}
                </Pie>
                <Tooltip content={<ModelTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="tabular text-lg font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {formatTokens(grandTotal)}
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                tokens
              </span>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            {data
              .slice()
              .sort((a, b) => b.tokens - a.tokens)
              .map((d) => {
                const pct = grandTotal ? (d.tokens / grandTotal) * 100 : 0;
                return (
                  <div key={d.name} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ background: colorMap.get(d.name) }}
                        />
                        <span style={{ color: "var(--text-secondary)" }}>{d.name}</span>
                      </span>
                      <span
                        className="tabular"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {formatTokens(d.tokens)} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="tabular pl-4" style={{ color: "var(--text-muted)" }}>
                      {formatCost(d.cost)}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </Frame>
  );
}

interface ModelRow {
  name: string;
  tokens: number;
  cost: number;
}
function ModelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ModelRow }[];
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
        {formatTokens(p.tokens)} tokens
      </div>
      <div className="tabular" style={{ color: "var(--text-secondary)" }}>
        {formatCost(p.cost)}
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

function Empty() {
  return (
    <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      No model data.
    </div>
  );
}