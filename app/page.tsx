import { getUsageDataset } from "@/lib/claude-data";
import DashboardHeader from "@/components/DashboardHeader";
import KpiTiles from "@/components/KpiTiles";
import DailyChart from "@/components/DailyChart";
import ModelBreakdown from "@/components/ModelBreakdown";
import ProjectBreakdown from "@/components/ProjectBreakdown";
import SessionTable from "@/components/SessionTable";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ds = await getUsageDataset();

  return (
    <div className="min-h-dvh">
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        <DashboardHeader
          generatedAt={ds.generatedAt}
          foundClaudeDir={ds.foundClaudeDir}
        />

        <section className="mb-6">
          <KpiTiles totals={ds.totals} daily={ds.daily} />
        </section>

        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DailyChart daily={ds.daily} />
          </div>
          <div>
            <ModelBreakdown byModel={ds.byModel} />
          </div>
        </section>

        <section className="mb-6">
          <ProjectBreakdown byProject={ds.byProject} />
        </section>

        <section className="mb-10">
          <SessionTable sessions={ds.sessions} />
        </section>

        <footer
          className="border-t pt-5 text-xs leading-relaxed"
          style={{
            borderColor: "var(--border-ring)",
            color: "var(--text-muted)",
          }}
        >
          Token totals include input, output, cache-creation, and cache-read
          tokens. Cost is an API-price equivalent, not your Pro/Max subscription
          bill.
        </footer>
      </main>
    </div>
  );
}