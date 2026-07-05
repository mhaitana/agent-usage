import { formatCost, formatTokens, formatDate } from "@/lib/format";
import type { Totals } from "@/lib/types";

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: "var(--surface-1)",
        borderColor: "var(--border-ring)",
      }}
    >
      <div
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="tabular mt-2 text-2xl font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function KpiTiles({ totals }: { totals: Totals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        label="Total tokens"
        value={formatTokens(totals.totalTokens)}
        sub={`${formatTokens(totals.outputTokens)} output`}
      />
      <Tile
        label="Est. cost (API-equiv)"
        value={formatCost(totals.cost)}
        sub="not your subscription bill"
      />
      <Tile
        label="Sessions"
        value={String(totals.sessions)}
        sub={`${totals.messages.toLocaleString()} messages`}
      />
      <Tile
        label="Tool calls"
        value={totals.toolCalls.toLocaleString()}
      />
      <Tile
        label="Active window"
        value={formatDate(totals.firstSeen)}
        sub={`→ ${formatDate(totals.lastSeen)}`}
      />
    </div>
  );
}