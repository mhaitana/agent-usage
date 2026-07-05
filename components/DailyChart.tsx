"use client";

import { useState } from "react";
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
import { Card, CardHeader } from "@/components/ui/Card";

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

  // Hidden series set — toggled by clicking the legend.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  // Flatten into one row per day with a column per model.
  const data = daily.map((d) => {
    const row: Record<string, number | string> = { date: d.date, total: d.totalTokens };
    for (const m of d.byModel) row[m.model] = m.tokens;
    return row;
  });

  const visibleModels = models.filter((m) => !hidden.has(m));

  return (
    <Card className="p-4" hover>
      <CardHeader
        title="Daily tokens"
        subtitle="Stacked by model · click a legend item to toggle"
        action={
          data.length > 0 ? (
            <span className="tabular" style={{ color: "var(--text-muted)" }}>
              {data.length}d
            </span>
          ) : undefined
        }
      />
      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                {visibleModels.map((m) => (
                  <linearGradient key={m} id={`grad-${cssId(m)}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colorMap.get(m)} stopOpacity={0.85} />
                    <stop offset="100%" stopColor={colorMap.get(m)} stopOpacity={0.35} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="var(--gridline)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatDay(String(v))}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--baseline)" }}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={(v) => formatTokens(Number(v))}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3", strokeWidth: 1 }}
                content={<DailyTooltip colorMap={colorMap} />}
              />
              {visibleModels.map((m, i) => (
                <Area
                  key={m}
                  type="monotone"
                  dataKey={m}
                  stackId="1"
                  stroke={colorMap.get(m)}
                  strokeWidth={1.5}
                  fill={`url(#grad-${cssId(m)})`}
                  // Subtle gap between stacked segments.
                  fillOpacity={i === visibleModels.length - 1 ? 1 : 0.92}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <Legend
            models={models}
            colorMap={colorMap}
            hidden={hidden}
            onToggle={(m) =>
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(m)) next.delete(m);
                else next.add(m);
                return next;
              })
            }
          />
        </>
      )}
    </Card>
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
      className="rounded-lg border p-2.5 text-xs shadow-[var(--shadow-lg)]"
      style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)" }}
    >
      <div className="mb-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
        {label ? formatFullDate(String(label)) : ""}
      </div>
      {rows.map((r) => (
        <div key={r.dataKey} className="flex items-center gap-2.5 tabular">
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
        className="mt-1.5 flex justify-between border-t pt-1.5 tabular font-medium"
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
  hidden,
  onToggle,
}: {
  models: string[];
  colorMap: Map<string, string>;
  hidden: ReadonlySet<string>;
  onToggle: (m: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 text-xs" style={{ borderColor: "var(--border-ring)" }}>
      {models.map((m) => {
        const isHidden = hidden.has(m);
        return (
          <button
            key={m}
            type="button"
            onClick={() => onToggle(m)}
            aria-pressed={!isHidden}
            title={isHidden ? `Show ${m}` : `Hide ${m}`}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors duration-150"
            style={{
              background: isHidden ? "transparent" : "var(--surface-sunken)",
              borderColor: "var(--border-ring)",
              color: isHidden ? "var(--text-muted)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background: colorMap.get(m),
                opacity: isHidden ? 0.35 : 1,
              }}
            />
            <span>{m}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="py-16 text-center text-sm"
      style={{ color: "var(--text-muted)" }}
    >
      No session data found yet.
    </div>
  );
}

/** Compact axis tick: "Jul 3" */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Full tooltip header: "Jul 3, 2026" */
function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}