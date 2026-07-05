import { Github } from "@/components/ui/icons";

/**
 * Shared dashboard footer — token/cost caveat + GitHub repo pill. Extracted
 * so the overview and per-agent pages render the same footer without
 * duplication. Presentational; no client state.
 */
export default function SiteFooter() {
  return (
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
  );
}