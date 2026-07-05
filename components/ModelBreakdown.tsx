"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ModelTotal } from "@/lib/types";
import { buildColorMap } from "@/lib/palette";
import { formatCost, formatTokens } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";

export default function ModelBreakdown({ byModel }: { byModel: ModelTotal[] }) {
  const models = byModel.map((m) => m.model);
  const colorMap = buildColorMap(models);
  const data = byModel
    .map((m) => ({ name: m.model, tokens: m.totalTokens, cost: m.cost }))
    .sort((a, b) => b.tokens - a.tokens);
  const grandTotal = data.reduce((s, d) => s + d.tokens, 0);

  return (
    <Card className="h-full p-4" hover>
      <CardHeader title="By model" subtitle="Share of total tokens" />
      {data.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row lg:flex-col">
          <div className="relative h-[200px] w-full sm:w-1/2 lg:w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="tokens"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={82}
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
                className="tabular text-lg font-semibold leading-none"
                style={{ color: "var(--text-primary)" }}
              >
                {formatTokens(grandTotal)}
              </span>
              <span
                className="mt-1 text-[10px] uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                tokens
              </span>
            </div>
          </div>
          <div className="flex-1 space-y-2.5">
            {data.map((d) => {
              const pct = grandTotal ? (d.tokens / grandTotal) * 100 : 0;
              return (
                <div key={d.name} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: colorMap.get(d.name) }}
                      />
                      <span
                        className="truncate"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {d.name}
                      </span>
                    </span>
                    <span
                      className="tabular shrink-0 font-medium"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  {/* Share bar — encodes magnitude without relying on color alone. */}
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--surface-sunken)" }}
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
                    <span>{formatTokens(d.tokens)} tokens</span>
                    <span>{formatCost(d.cost)}</span>
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
      className="rounded-lg border p-2.5 text-xs shadow-[var(--shadow-lg)]"
      style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)" }}
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

function Empty() {
  return (
    <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      No model data.
    </div>
  );
}