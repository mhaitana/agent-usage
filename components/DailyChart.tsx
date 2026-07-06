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
  /** "tokens" (default) stacks tokens by model; "sessions" plots a single
   *  sessions-per-day area for activity-only adapters (Antigravity). */
  mode?: "tokens" | "sessions";
}

export default function DailyChart({ daily, mode = "tokens" }: Props) {
  // Hidden series set — toggled by clicking the legend. Declared before the
  // mode early-return so hook order stays stable across renders.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  if (mode === "sessions") return <SessionsChart daily={daily} />;

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
                    <stop offset="0%" stopColor={colorMap.get(m)} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={colorMap.get(m)} stopOpacity={0.7} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatDay(String(v))}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
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
                  stroke="var(--text)"
                  strokeWidth={1.5}
                  fill={`url(#grad-${cssId(m)})`}
                  // Top band solid; lower bands slightly translucent so the
                  // dark separator strokes between stacked bands stay visible.
                  fillOpacity={i === visibleModels.length - 1 ? 1 : 0.9}
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
      className="text-xs"
      style={{
        background: "var(--bg)",
        border: "3px solid var(--text)",
        borderRadius: "var(--radius-card)",
        boxShadow: "5px 5px 0 var(--shadow-hard)",
        padding: "12px",
      }}
    >
      <div className="mb-1.5 font-medium" style={{ color: "var(--text)" }}>
        {label ? formatFullDate(String(label)) : ""}
      </div>
      {rows.map((r) => (
        <div key={r.dataKey} className="flex items-center gap-2.5 tabular">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{
              background: colorMap.get(r.dataKey),
              border: "1.5px solid var(--text)",
            }}
          />
          <span className="grow" style={{ color: "var(--text-muted)" }}>
            {r.dataKey}
          </span>
          <span style={{ color: "var(--text)" }}>
            {formatTokens(Number(r.value))}
          </span>
        </div>
      ))}
      <div
        className="mt-1.5 flex justify-between border-t pt-1.5 tabular font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
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
    <div className="mt-4 flex flex-wrap gap-2 border-t-[3px] pt-4 text-xs" style={{ borderColor: "var(--text)" }}>
      {models.map((m) => {
        const isHidden = hidden.has(m);
        return (
          <button
            key={m}
            type="button"
            onClick={() => onToggle(m)}
            aria-pressed={!isHidden}
            title={isHidden ? `Show ${m}` : `Hide ${m}`}
            className="pill clay-press inline-flex items-center gap-1.5 px-2.5 py-1"
            style={{
              background: isHidden ? "transparent" : "var(--accent-mint)",
              color: isHidden ? "var(--text-muted)" : "var(--ink)",
              cursor: "pointer",
            }}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background: colorMap.get(m),
                border: "2px solid var(--text)",
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

/** Single-area sessions-per-day chart for activity-only adapters. Same clay
 *  card chrome as the token chart; Y axis is a plain count, no model legend. */
function SessionsChart({ daily }: { daily: DailyPoint[] }) {
  const data = daily.map((d) => ({ date: d.date, sessions: d.sessions }));
  const peak = data.reduce((m, d) => Math.max(m, d.sessions), 0);

  return (
    <Card className="p-4" hover>
      <CardHeader
        title="Daily sessions"
        subtitle="Sessions per day"
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
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="grad-sessions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.7} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => formatDay(String(v))}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={28}
            />
            <YAxis
              tickFormatter={(v) => Number(v).toLocaleString()}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3", strokeWidth: 1 }}
              content={<SessionsTooltip />}
            />
            <Area
              type="monotone"
              dataKey="sessions"
              stroke="var(--text)"
              strokeWidth={1.5}
              fill="url(#grad-sessions)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
      {peak > 0 && (
        <div
          className="mt-3 text-xs font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="tabular">Peak {peak.toLocaleString()}</span> sessions/day
        </div>
      )}
    </Card>
  );
}

function SessionsTooltip({
  active,
  payload,
  label,
}: RechartsTooltipProps) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0]?.value ?? 0);
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
      <div className="mb-1.5 font-medium" style={{ color: "var(--text)" }}>
        {label ? formatFullDate(String(label)) : ""}
      </div>
      <div className="tabular" style={{ color: "var(--text-muted)" }}>
        {v.toLocaleString()} sessions
      </div>
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