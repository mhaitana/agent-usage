"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "@/lib/types";
import { buildColorMap } from "@/lib/palette";
import { formatTokens } from "@/lib/format";

interface TooltipEntry {
  dataKey: string;
  value: number;
  payload?: Record<string, unknown>;
}
interface RechartsTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

interface Props {
  daily: DailyPoint[];
}

export default function DailyChart({ daily }: Props) {
  // Collect all models across days in stable order.
  const modelSet = new Set<string>();
  for (const d of daily) for (const m of d.byModel) modelSet.add(m.model);
  const models = [...modelSet].sort();
  const colorMap = buildColorMap(models);

  // Flatten into one row per day with a column per model.
  const data = daily.map((d) => {
    const row: Record<string, number | string> = { date: d.date, total: d.totalTokens };
    for (const m of d.byModel) row[m.model] = m.tokens;
    return row;
  });

  if (data.length === 0) {
    return <EmptyState />;
  }

  return (
    <ChartFrame title="Daily tokens" subtitle="Stacked by model">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {models.map((m) => (
              <linearGradient key={m} id={`grad-${cssId(m)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorMap.get(m)} stopOpacity={0.85} />
                <stop offset="100%" stopColor={colorMap.get(m)} stopOpacity={0.35} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--baseline)" }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => formatTokens(Number(v))}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
            content={<DailyTooltip colorMap={colorMap} />}
          />
          {models.map((m, i) => (
            <Area
              key={m}
              type="monotone"
              dataKey={m}
              stackId="1"
              stroke={colorMap.get(m)}
              strokeWidth={1.5}
              fill={`url(#grad-${cssId(m)})`}
              // 2px surface gap between stacked segments via fill opacity below.
              fillOpacity={i === models.length - 1 ? 1 : 0.92}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <Legend models={models} colorMap={colorMap} />
    </ChartFrame>
  );
}

function DailyTooltip({
  active,
  payload,
  label,
  colorMap,
}: RechartsTooltipProps & { colorMap: Map<string, string> }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => Number(p.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const total = rows.reduce((s, r) => s + Number(r.value), 0);
  return (
    <div
      className="rounded-md border p-2 text-xs shadow-sm"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-ring)" }}
    >
      <div className="mb-1 font-medium" style={{ color: "var(--text-primary)" }}>
        {label}
      </div>
      {rows.map((r) => (
        <div key={r.dataKey} className="flex items-center gap-2 tabular">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: colorMap.get(r.dataKey) }}
          />
          <span className="grow" style={{ color: "var(--text-secondary)" }}>
            {r.dataKey}
          </span>
          <span style={{ color: "var(--text-primary)" }}>
            {formatTokens(Number(r.value))}
          </span>
        </div>
      ))}
      <div
        className="mt-1 flex justify-between border-t pt-1 tabular font-medium"
        style={{ borderColor: "var(--gridline)", color: "var(--text-primary)" }}
      >
        <span>Total</span>
        <span>{formatTokens(total)}</span>
      </div>
    </div>
  );
}

function Legend({
  models,
  colorMap,
}: {
  models: string[];
  colorMap: Map<string, string>;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {models.map((m) => (
        <span key={m} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: colorMap.get(m) }}
          />
          <span style={{ color: "var(--text-secondary)" }}>{m}</span>
        </span>
      ))}
    </div>
  );
}

function ChartFrame({
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
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
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

function EmptyState() {
  return (
    <div
      className="rounded-lg border p-8 text-center text-sm"
      style={{
        background: "var(--surface-1)",
        borderColor: "var(--border-ring)",
        color: "var(--text-muted)",
      }}
    >
      No session data found yet.
    </div>
  );
}

function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}