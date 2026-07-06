import type { ReactNode } from "react";
import type { DailyPoint, ModelTotal, ProjectTotal, Totals } from "@/lib/types";
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
  Folder,
} from "@/components/ui/icons";

/**
 * Block-based KPI tile. Each tile carries a pastel block color used for the
 * icon chip (thick dark border + hard offset shadow) and the accent strip,
 * so the row reads as a strip of colored blocks. White card body keeps the
 * value legible.
 */
function Tile({
  icon,
  label,
  value,
  sub,
  block,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: ReactNode;
  /** CSS color (pastel var or hex) for the tile's block identity. */
  block: string;
  className?: string;
}) {
  return (
    <Card hover className={`relative p-4 ${className}`}>
      <div className="flex items-center gap-2.5">
        {/* Pastel icon chip — 3px dark border + hard offset shadow. */}
        <span
          className="inline-flex h-10 w-10 items-center justify-center"
          style={{
            background: block,
            border: "3px solid var(--text)",
            borderRadius: "var(--radius-chip)",
            boxShadow: "3px 3px 0 var(--shadow-hard)",
            color: "var(--ink)",
            fontSize: "1.1em",
          }}
          aria-hidden
        >
          {icon}
        </span>
        <span
          className="pill inline-block px-2.5 py-1 text-[10px] uppercase tracking-wider"
          style={{ background: block, fontSize: "10px" }}
        >
          {label}
        </span>
      </div>
      <div
        className="tabular mt-3 text-[26px] font-extrabold leading-none tracking-tight"
        style={{ color: "var(--text)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-2 text-xs font-medium leading-snug"
          style={{ color: "var(--text-muted)" }}
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
  byModel,
  byProject,
  mode = "tokens",
}: {
  totals: Totals;
  daily: DailyPoint[];
  /** Activity-mode tiles (Models / Projects) read these; ignored in token mode. */
  byModel?: ModelTotal[];
  byProject?: ProjectTotal[];
  /** "tokens" (default) shows the token/cost-centric tile set; "activity" shows
   *  sessions / messages / tool calls / models / projects / active window for
   *  adapters that don't write token data to disk (Antigravity). */
  mode?: "tokens" | "activity";
}) {
  if (mode === "activity") return <ActivityTiles totals={totals} daily={daily} byModel={byModel ?? []} byProject={byProject ?? []} />;

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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {/* Hero KPI — spans 2 cols on large screens, carries the trend sparkline
          and two decorative pastel shapes on its corners. */}
      <Card hover className="relative overflow-hidden p-4 lg:col-span-2">
        {/* Decorative shapes (neo-brutalist clay accent). */}
        <span
          aria-hidden
          className="absolute -top-4 -right-4 h-14 w-14 rotate-6"
          style={{
            background: "var(--accent-mint)",
            border: "3px solid var(--text)",
            borderRadius: "var(--radius-chip)",
            boxShadow: "3px 3px 0 var(--shadow-hard)",
          }}
        />
        <span
          aria-hidden
          className="absolute -bottom-4 -left-4 h-10 w-10 rounded-full"
          style={{
            background: "var(--accent-coral)",
            border: "3px solid var(--text)",
            boxShadow: "2px 2px 0 var(--shadow-hard)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <span
            className="inline-flex h-10 w-10 items-center justify-center"
            style={{
              background: "var(--block-1)",
              border: "3px solid var(--text)",
              borderRadius: "var(--radius-chip)",
              boxShadow: "3px 3px 0 var(--shadow-hard)",
              color: "var(--ink)",
              fontSize: "1.1em",
            }}
            aria-hidden
          >
            <TrendingUp />
          </span>
          <span
            className="pill inline-block px-2.5 py-1 text-[10px] uppercase tracking-wider"
            style={{ background: "var(--block-1)" }}
          >
            Total tokens
          </span>
        </div>
        <div className="relative mt-3 flex items-end justify-between gap-3">
          <div
            className="tabular text-[30px] font-extrabold leading-none tracking-tight"
            style={{ color: "var(--text)" }}
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
          className="relative mt-2 flex items-center gap-2 text-xs font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="tabular">{formatTokens(totals.outputTokens)} output</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span className="tabular">{formatTokens(last7Tokens)} last 7d</span>
        </div>
      </Card>

      <Tile
        icon={<Coins />}
        label="Est. cost"
        block="var(--block-2)"
        value={formatCost(totals.cost)}
        sub={
          <span>
            <span className="tabular font-bold" style={{ color: "var(--text)" }}>{formatCost(last7Cost)}</span> last 7d ·{" "}
            <span className="tabular font-bold" style={{ color: "var(--text)" }}>{formatCost(avgCostPerSession)}</span>/session
            <span className="block" style={{ color: "var(--text-muted)" }}>
              API-equiv, not your subscription bill
            </span>
          </span>
        }
      />
      <Tile
        icon={<Messages />}
        label="Sessions"
        block="var(--block-3)"
        value={totals.sessions.toLocaleString()}
        sub={
          <span className="tabular font-bold" style={{ color: "var(--text)" }}>
            {totals.messages.toLocaleString()} messages
          </span>
        }
      />
      <Tile
        icon={<Wrench />}
        label="Tool calls"
        block="var(--block-4)"
        value={totals.toolCalls.toLocaleString()}
        sub={
          <span className="tabular font-bold" style={{ color: "var(--text)" }}>
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
        block="var(--block-5)"
        value={formatTokens(totals.cacheReadTokens)}
        sub={
          <span>
            of <span className="tabular font-bold" style={{ color: "var(--text)" }}>{formatTokens(totals.inputTokens + totals.cacheReadTokens)}</span> total in
          </span>
        }
      />
      <Tile
        icon={<Calendar />}
        label="Active window"
        block="var(--block-6)"
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

/** Activity-mode KPI set for adapters that don't write token data to disk
 *  (Antigravity). Replaces token/cost tiles with sessions / messages / tool
 *  calls / models / projects / active window — all from existing Totals +
 *  daily.sessions + byModel/byProject, no new aggregation needed. */
function ActivityTiles({
  totals,
  daily,
  byModel,
  byProject,
}: {
  totals: Totals;
  daily: DailyPoint[];
  byModel: ModelTotal[];
  byProject: ProjectTotal[];
}) {
  const recent = daily.slice(-14);
  const sparkValues = recent.map((d) => d.sessions);
  const topModel = [...byModel].sort((a, b) => b.sessions - a.sessions)[0]?.model;
  const topProject = [...byProject].sort((a, b) => b.sessions - a.sessions)[0]?.project;
  const msgsPerSession = totals.sessions ? totals.messages / totals.sessions : 0;
  const toolsPerSession = totals.sessions ? totals.toolCalls / totals.sessions : 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {/* Hero — Sessions, with a 14-day session-count sparkline. */}
      <Card hover className="relative overflow-hidden p-4 lg:col-span-2">
        <span
          aria-hidden
          className="absolute -top-4 -right-4 h-14 w-14 rotate-6"
          style={{
            background: "var(--accent-mint)",
            border: "3px solid var(--text)",
            borderRadius: "var(--radius-chip)",
            boxShadow: "3px 3px 0 var(--shadow-hard)",
          }}
        />
        <span
          aria-hidden
          className="absolute -bottom-4 -left-4 h-10 w-10 rounded-full"
          style={{
            background: "var(--accent-coral)",
            border: "3px solid var(--text)",
            boxShadow: "2px 2px 0 var(--shadow-hard)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <span
            className="inline-flex h-10 w-10 items-center justify-center"
            style={{
              background: "var(--block-1)",
              border: "3px solid var(--text)",
              borderRadius: "var(--radius-chip)",
              boxShadow: "3px 3px 0 var(--shadow-hard)",
              color: "var(--ink)",
              fontSize: "1.1em",
            }}
            aria-hidden
          >
            <TrendingUp />
          </span>
          <span
            className="pill inline-block px-2.5 py-1 text-[10px] uppercase tracking-wider"
            style={{ background: "var(--block-1)" }}
          >
            Sessions
          </span>
        </div>
        <div className="relative mt-3 flex items-end justify-between gap-3">
          <div
            className="tabular text-[30px] font-extrabold leading-none tracking-tight"
            style={{ color: "var(--text)" }}
          >
            {totals.sessions.toLocaleString()}
          </div>
          {sparkValues.length > 1 && (
            <Sparkline
              values={sparkValues}
              color="var(--series-1)"
              ariaLabel={`Daily sessions over the last ${sparkValues.length} days`}
            />
          )}
        </div>
        <div
          className="relative mt-2 flex items-center gap-2 text-xs font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="tabular">{totals.messages.toLocaleString()} messages</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span className="tabular">{totals.toolCalls.toLocaleString()} tool calls</span>
        </div>
      </Card>

      <Tile
        icon={<Messages />}
        label="Messages"
        block="var(--block-2)"
        value={totals.messages.toLocaleString()}
        sub={
          <span className="tabular font-bold" style={{ color: "var(--text)" }}>
            {msgsPerSession.toFixed(1)} per session
          </span>
        }
      />
      <Tile
        icon={<Wrench />}
        label="Tool calls"
        block="var(--block-3)"
        value={totals.toolCalls.toLocaleString()}
        sub={
          <span className="tabular font-bold" style={{ color: "var(--text)" }}>
            {toolsPerSession.toFixed(1)} per session
          </span>
        }
      />
      <Tile
        icon={<Cpu />}
        label="Models"
        block="var(--block-4)"
        value={byModel.length.toLocaleString()}
        sub={
          <span className="truncate font-bold" style={{ color: "var(--text)" }}>
            {topModel ?? "—"}
          </span>
        }
      />
      <Tile
        icon={<Folder />}
        label="Projects"
        block="var(--block-5)"
        value={byProject.length.toLocaleString()}
        sub={
          <span className="truncate font-bold" style={{ color: "var(--text)" }}>
            {topProject ?? "—"}
          </span>
        }
      />
      <Tile
        icon={<Calendar />}
        label="Active window"
        block="var(--block-6)"
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