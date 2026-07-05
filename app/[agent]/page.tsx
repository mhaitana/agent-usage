import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  adapterMeta,
  getUsageDataset,
  knownSlugs,
  scopeDataset,
} from "@/lib/usage-data";
import DashboardHeader from "@/components/DashboardHeader";
import SiteFooter from "@/components/SiteFooter";
import KpiTiles from "@/components/KpiTiles";
import DailyChart from "@/components/DailyChart";
import ModelBreakdown from "@/components/ModelBreakdown";
import ProjectBreakdown from "@/components/ProjectBreakdown";
import SessionTable from "@/components/SessionTable";

export const dynamic = "force-dynamic";

// Title renders as "{Agent name} · Agent Usage" via the layout template.
// Resolved from the adapter registry without parsing sessions (cheap), so
// metadata generation is independent of the full dataset fan-out.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ agent: string }>;
}): Promise<Metadata> {
  const { agent } = await params;
  const meta = adapterMeta().find((a) => a.slug === agent);
  if (!meta) return {};
  return {
    title: meta.name,
    description: `Token, cost, and session usage for ${meta.name}, read live from ${meta.dirLabel}.`,
  };
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;
  if (!knownSlugs().includes(agent)) notFound();

  const ds = await getUsageDataset();
  const scoped = scopeDataset(ds, agent);
  const active = ds.adapters.find((a) => a.slug === agent);

  // `active` is guaranteed present because the slug passed knownSlugs(), but
  // guard defensively in case the data dir disappeared between calls.
  if (!active) notFound();

  return (
    <div className="min-h-dvh">
      <DashboardHeader
        badge={active.name}
        titleTail="usage"
        subtitle={active.dirLabel}
        adapters={ds.adapters}
        activeSlug={agent}
        generatedAt={ds.generatedAt}
      />

      <main className="relative mx-auto max-w-[1280px] px-4 pb-10 pt-8 sm:px-6">
        {scoped.sessions.length === 0 ? (
          <div
            className="soft-clay p-6 text-sm font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            No sessions found for {active.name} at{" "}
            <code className="mono">{active.dirLabel}</code>. Use the agent in
            this directory tree, or set{" "}
            <code className="mono">{`${active.slug.toUpperCase()}_DIR`}</code> to
            point at its data.
          </div>
        ) : (
          <>
            <section className="mb-8">
              <KpiTiles totals={scoped.totals} daily={scoped.daily} />
            </section>

            <section className="mb-8 grid gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <DailyChart daily={scoped.daily} />
              </div>
              <div>
                <ModelBreakdown byModel={scoped.byModel} />
              </div>
            </section>

            <section className="mb-8">
              <ProjectBreakdown byProject={scoped.byProject} />
            </section>

            <section className="mb-10">
              <SessionTable sessions={scoped.sessions} />
            </section>
          </>
        )}

        <SiteFooter />
      </main>
    </div>
  );
}