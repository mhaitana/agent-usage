"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Refresh, Alert } from "@/components/ui/icons";

/**
 * Dashboard top bar: product title, a live "updated" indicator with a
 * soft pulse, and a refresh action that re-runs the server data fetch.
 * Local-only — refresh just re-reads ~/.claude on the server.
 */
export default function DashboardHeader({
  generatedAt,
  foundClaudeDir,
}: {
  generatedAt: string;
  foundClaudeDir: boolean;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    router.refresh();
    // router.refresh() returns synchronously; the server re-render resolves
    // on the next tick. Brief timeout so the spinner reads as real feedback.
    setTimeout(() => setRefreshing(false), 600);
  }, [router]);

  return (
    <header className="mb-7">
      {!foundClaudeDir && (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-lg border p-3 text-sm"
          style={{
            background: "var(--surface-sunken)",
            borderColor: "var(--border-strong)",
            color: "var(--text-secondary)",
          }}
          role="alert"
        >
          <Alert
            className="mt-0.5 shrink-0"
            style={{ color: "var(--series-3)", fontSize: "1.05em" }}
          />
          <div>
            Could not find <code className="mono">~/.claude</code>. Set{" "}
            <code className="mono">CLAUDE_DIR</code> to point at your Claude Code
            config directory.
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-2 w-2 shrink-0 rounded-full"
              style={{
                background: "var(--series-2)",
                boxShadow: "0 0 0 0 var(--series-2)",
                animation: "pulse 2.4s cubic-bezier(0.4,0,0.6,1) infinite",
              }}
              aria-hidden
            />
            <h1
              className="text-lg font-semibold tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              Claude Code usage
            </h1>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Live read of <code className="mono">~/.claude/projects</code> · updated{" "}
            <time
              dateTime={generatedAt}
              className="tabular"
              style={{ color: "var(--text-secondary)" }}
            >
              {new Date(generatedAt).toLocaleTimeString("en-US")}
            </time>
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh usage data"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: "var(--surface-2)",
            borderColor: "var(--border-ring)",
            color: "var(--text-secondary)",
          }}
        >
          <Refresh
            className={refreshing ? "animate-spin" : ""}
            style={{ fontSize: "0.95em" }}
          />
          <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--series-2) 50%, transparent); }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </header>
  );
}