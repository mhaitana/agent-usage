import { getUsageDataset } from "@/lib/usage-data";
import DashboardHeader from "@/components/DashboardHeader";
import KpiTiles from "@/components/KpiTiles";
import DailyChart from "@/components/DailyChart";
import ModelBreakdown from "@/components/ModelBreakdown";
import ProjectBreakdown from "@/components/ProjectBreakdown";
import SessionTable from "@/components/SessionTable";
import { Github } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ds = await getUsageDataset();

  return (
    <div className="min-h-dvh">
      {/* Hero band — a bold pastel block with a thick dark border + hard
          offset shadow (neo-brutalist clay header). Decorative shape accents. */}
      <div
        className="relative overflow-hidden"
        style={{
          background: "var(--bg-cream)",
          borderBottom: "3px solid var(--text)",
          boxShadow: "0 6px 0 var(--shadow-hard)",
        }}
      >
        {/* Decorative shapes flanking the header. */}
        <span
          aria-hidden
          className="absolute -top-5 right-[8%] hidden h-16 w-16 -rotate-12 lg:block"
          style={{
            background: "var(--accent-purple)",
            border: "3px solid var(--text)",
            borderRadius: "var(--radius-chip)",
            boxShadow: "4px 4px 0 var(--shadow-hard)",
          }}
        />
        <span
          aria-hidden
          className="absolute -bottom-5 right-[20%] hidden h-10 w-10 rounded-full lg:block"
          style={{
            background: "var(--secondary)",
            border: "3px solid var(--text)",
            boxShadow: "3px 3px 0 var(--shadow-hard)",
          }}
        />
        <div className="relative mx-auto max-w-[1280px] px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
          <DashboardHeader
            generatedAt={ds.generatedAt}
            adapters={ds.adapters}
          />
        </div>
      </div>

      <main className="relative mx-auto max-w-[1280px] px-4 pb-10 pt-8 sm:px-6">
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

        <footer
          className="border-t-[3px] pt-5 text-xs font-medium leading-relaxed"
          style={{
            borderColor: "var(--text)",
            color: "var(--text-muted)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose">
              Token totals include input, output, cache-creation, and cache-read
              tokens. Cost is an API-price equivalent, not your Pro/Max
              subscription bill.
            </p>
            <a
              href="https://github.com/mhaitana/agent-usage"
              target="_blank"
              rel="noopener noreferrer"
              className="pill clay-press inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs"
              style={{ background: "var(--bg-sunken)" }}
            >
              <Github title="GitHub repo" />
              <span>mhaitana/agent-usage</span>
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}