import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Cpu } from "@/components/ui/icons";
import { formatCost, formatTokens } from "@/lib/format";

/**
 * One summary card per registered agent, for the overview hub. Each card
 * links to that agent's own page (`/{slug}`) and shows its session count,
 * total tokens, and API-price-equivalent cost. If the agent's data dir wasn't
 * found, the card shows a muted "not found" state with a hint to set its env
 * override (the card still links through to the page, which surfaces the
 * banner).
 */
export interface AgentCard {
  slug: string;
  name: string;
  dirLabel: string;
  available: boolean;
  sessions: number;
  totalTokens: number;
  cost: number;
}

// Pastel chip palette — cycle through the on-theme block tokens so each card
// gets a distinct accent without hardcoding hex.
const CHIP = [
  "var(--block-1)",
  "var(--block-2)",
  "var(--block-3)",
  "var(--block-4)",
  "var(--block-5)",
  "var(--block-6)",
];

export default function AgentCards({ cards }: { cards: AgentCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c, i) => (
        <Link
          key={c.slug}
          href={`/${c.slug}`}
          className="block focus:outline-none"
        >
          <Card hover className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex h-9 w-9 items-center justify-center"
                style={{
                  background: CHIP[i % CHIP.length],
                  border: "3px solid var(--text)",
                  borderRadius: "var(--radius-chip)",
                  boxShadow: "3px 3px 0 var(--shadow-hard)",
                  color: "var(--ink)",
                  fontSize: "1em",
                }}
                aria-hidden
              >
                <Cpu />
              </span>
              <div className="min-w-0">
                <div
                  className="text-sm font-extrabold leading-tight"
                  style={{ color: "var(--text)" }}
                >
                  {c.name}
                </div>
                <code
                  className="mono text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {c.dirLabel}
                </code>
              </div>
            </div>

            {c.available ? (
              <div
                className="mt-auto grid grid-cols-3 gap-2 border-t-[3px] pt-3"
                style={{ borderColor: "var(--text)" }}
              >
                <Stat label="Sessions" value={String(c.sessions)} />
                <Stat label="Tokens" value={formatTokens(c.totalTokens)} />
                <Stat label="Est. cost" value={formatCost(c.cost)} />
              </div>
            ) : (
              <div
                className="mt-auto border-t-[3px] pt-3 text-xs font-semibold"
                style={{ borderColor: "var(--text)", color: "var(--text-muted)" }}
              >
                Not found — set{" "}
                <code className="mono">{`${c.slug.toUpperCase()}_DIR`}</code>
              </div>
            )}

            <div
              className="text-xs font-bold"
              style={{ color: "var(--text-muted)" }}
            >
              View {c.name} →
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="num tabular text-sm font-extrabold leading-tight"
        style={{ color: "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}