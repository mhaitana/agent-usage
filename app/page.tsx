import {
  getUsageDataset,
  perAdapterTotals,
} from "@/lib/usage-data";
import DashboardHeader from "@/components/DashboardHeader";
import AgentCards, { type AgentCard } from "@/components/AgentCards";
import SiteFooter from "@/components/SiteFooter";
import KpiTiles from "@/components/KpiTiles";
import DailyChart from "@/components/DailyChart";
import ModelBreakdown from "@/components/ModelBreakdown";
import ProjectBreakdown from "@/components/ProjectBreakdown";
import SessionTable from "@/components/SessionTable";

export const dynamic = "force-dynamic";

// The layout's `title.template` ("%s · Agent Usage") only applies to child
// segments, and `app/page.tsx` is the same segment as the root layout — so the
// template doesn't fire here. Spell the full title out to stay consistent with
// the per-agent pages ("Claude Code · Agent Usage", "Codex · Agent Usage").
export const metadata = {
  title: "Overview · Agent Usage",
  description:
    "Combined token, cost, and session usage across all coding agents — Claude Code and Codex.",
};

export default async function Home() {
  const ds = await getUsageDataset();

  // Per-agent summary cards: merge adapter status (name/dirLabel/available/
  // sessions) with per-adapter token + cost totals.
  const totals = new Map(
    perAdapterTotals(ds).map((t) => [t.slug, t]),
  );
  const cards: AgentCard[] = ds.adapters.map((a) => {
    const t = totals.get(a.slug);
    return {
      slug: a.slug,
      name: a.name,
      dirLabel: a.dirLabel,
      available: a.available,
      sessions: a.sessions,
      totalTokens: t?.totalTokens ?? 0,
      cost: t?.cost ?? 0,
    };
  });

  const subtitle = ds.adapters.map((a) => a.dirLabel).join(" + ");

  return (
    <div className="min-h-dvh">
      <DashboardHeader
        badge="Overview"
        titleTail="agent usage"
        subtitle={subtitle}
        adapters={ds.adapters}
        activeSlug={null}
        generatedAt={ds.generatedAt}
      />

      <main className="relative mx-auto max-w-[1280px] px-4 pb-10 pt-8 sm:px-6">
        <section className="mb-8">
          <h2
            className="mb-3 text-xs font-bold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Agents
          </h2>
          <AgentCards cards={cards} />
        </section>

        <section className="mb-8">
          <KpiTiles totals={ds.totals} daily={ds.daily} />
        </section>

        <section className="mb-8 grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DailyChart daily={ds.daily} />
          </div>
          <div>
            <ModelBreakdown byModel={ds.byModel} />
          </div>
        </section>

        <section className="mb-8">
          <ProjectBreakdown byProject={ds.byProject} />
        </section>

        <section className="mb-10">
          <SessionTable sessions={ds.sessions} />
        </section>

        <SiteFooter />
      </main>
    </div>
  );
}