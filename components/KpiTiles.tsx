import type { ReactNode } from "react";
import type { DailyPoint, Totals } from "@/lib/types";
import { formatCost, formatTokens, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";
import {
  Coins,
  Messages,
  Wrench,
  Calendar,
  Cpu,
  TrendingUp,
} from "@/components/ui/icons";

function Tile({
  icon,
  label,
  value,
  sub,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <Card hover className={`relative overflow-hidden p-4 ${className}`}>
      {/* Accent rail — a 2px tinted edge that gives each tile a quiet identity. */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: "color-mix(in srgb, var(--accent) 70%, transparent)" }}
        aria-hidden
      />
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-md"
          style={{
            background: "var(--surface-sunken)",
            color: "var(--text-secondary)",
            fontSize: "0.95em",
          }}
          aria-hidden
        >
          {icon}
        </span>
        <span
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      </div>
      <div
        className="tabular mt-3 text-[26px] font-semibold leading-none tracking-tight"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-2 text-xs leading-snug"
          style={{ color: "var(--text-secondary)" }}
        >
          {sub}
        </div>
      )}
    </Card>
  );
}

export default function KpiTiles({
  totals,
  daily,
}: {
  totals: Totals;
  daily: DailyPoint[];
}) {
  // Last 14 days of token activity for the hero sparkline.
  const recent = daily.slice(-14);
  const sparkValues = recent.map((d) => d.totalTokens);
  const last7 = daily.slice(-7);
  const last7Tokens = last7.reduce((s, d) => s + d.totalTokens, 0);
  const last7Cost = last7.reduce((s, d) => s + d.cost, 0);
  const avgCostPerSession = totals.sessions
    ? totals.cost / totals.sessions
    : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* Hero KPI — spans 2 cols on large screens, carries the trend sparkline. */}
      <Card hover className="relative overflow-hidden p-4 lg:col-span-2">
        <span
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: "var(--series-1)" }}
          aria-hidden
        />
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-md"
            style={{ background: "var(--surface-sunken)", color: "var(--series-1)", fontSize: "0.95em" }}
            aria-hidden
          >
            <TrendingUp />
          </span>
          <span
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Total tokens
          </span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div
            className="tabular text-[26px] font-semibold leading-none tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {formatTokens(totals.totalTokens)}
          </div>
          {sparkValues.length > 1 && (
            <Sparkline
              values={sparkValues}
              color="var(--series-1)"
              ariaLabel={`Daily tokens over the last ${sparkValues.length} days`}
            />
          )}
        </div>
        <div
          className="mt-2 flex items-center gap-3 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="tabular">{formatTokens(totals.outputTokens)} output</span>
          <span style={{ color: "var(--baseline)" }}>·</span>
          <span className="tabular">{formatTokens(last7Tokens)} last 7d</span>
        </div>
      </Card>

      <Tile
        icon={<Coins />}
        label="Est. cost"
        value={formatCost(totals.cost)}
        sub={
          <span>
            <span className="tabular">{formatCost(last7Cost)}</span> last 7d ·{" "}
            <span className="tabular">{formatCost(avgCostPerSession)}</span>/session
            <span className="block" style={{ color: "var(--text-muted)" }}>
              API-equiv, not your subscription bill
            </span>
          </span>
        }
      />
      <Tile
        icon={<Messages />}
        label="Sessions"
        value={totals.sessions.toLocaleString()}
        sub={
          <span className="tabular">
            {totals.messages.toLocaleString()} messages
          </span>
        }
      />
      <Tile
        icon={<Wrench />}
        label="Tool calls"
        value={totals.toolCalls.toLocaleString()}
        sub={
          <span className="tabular">
            {totals.sessions
              ? (totals.toolCalls / totals.sessions).toFixed(1)
              : "0"}{" "}
            per session
          </span>
        }
      />
      <Tile
        icon={<Cpu />}
        label="Cache read"
        value={formatTokens(totals.cacheReadTokens)}
        sub={
          <span style={{ color: "var(--text-muted)" }}>
            of <span className="tabular">{formatTokens(totals.inputTokens + totals.cacheReadTokens)}</span> total in
          </span>
        }
      />
      <Tile
        icon={<Calendar />}
        label="Active window"
        value={formatDate(totals.firstSeen)}
        sub={
          <span style={{ color: "var(--text-muted)" }}>
            → {formatDate(totals.lastSeen)}
          </span>
        }
      />
    </div>
  );
}