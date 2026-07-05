import { getUsageDataset } from "@/lib/claude-data";
import KpiTiles from "@/components/KpiTiles";
import DailyChart from "@/components/DailyChart";
import ModelBreakdown from "@/components/ModelBreakdown";
import ProjectBreakdown from "@/components/ProjectBreakdown";
import SessionTable from "@/components/SessionTable";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ds = await getUsageDataset();

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Claude Code usage
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Live read of <code>~/.claude/projects</code> · updated{" "}
            {new Date(ds.generatedAt).toLocaleTimeString("en-US")}
          </p>
        </div>
      </header>

      {!ds.foundClaudeDir && (
        <div
          className="mb-4 rounded-lg border p-3 text-sm"
          style={{
            background: "var(--surface-1)",
            borderColor: "var(--border-ring)",
            color: "var(--text-secondary)",
          }}
        >
          Could not find <code>~/.claude</code>. Set <code>CLAUDE_DIR</code> to point at your Claude
          Code config directory.
        </div>
      )}

      <section className="mb-4">
        <KpiTiles totals={ds.totals} />
      </section>

      <section className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyChart daily={ds.daily} />
        </div>
        <div>
          <ModelBreakdown byModel={ds.byModel} />
        </div>
      </section>

      <section className="mb-4">
        <ProjectBreakdown byProject={ds.byProject} />
      </section>

      <section className="mb-8">
        <SessionTable sessions={ds.sessions} />
      </section>

      <footer className="text-xs" style={{ color: "var(--text-muted)" }}>
        Token totals include input, output, cache-creation, and cache-read tokens. Cost is an
        API-price equivalent, not your Pro/Max subscription bill.
      </footer>
    </main>
  );
}