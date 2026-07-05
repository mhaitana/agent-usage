"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Refresh, Alert } from "@/components/ui/icons";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import type { AdapterStatus } from "@/lib/types";

/**
 * Dashboard top bar: product title, a live "updated" indicator with a
 * soft pulse, and a refresh action that re-runs the server data fetch.
 * Local-only — refresh just re-reads each adapter's data dir on the server.
 */
export default function DashboardHeader({
  generatedAt,
  adapters,
}: {
  generatedAt: string;
  adapters: AdapterStatus[];
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

  // Show a banner only when an adapter is unavailable (its data dir is
  // missing). Lists each missing tool with a hint to set its env override.
  const missing = adapters.filter((a) => !a.available);

  return (
    <header className="mb-8">
      {missing.length > 0 && (
        <div
          className="pill mb-4 flex items-start gap-2.5 p-3 text-sm font-medium"
          style={{
            background: "var(--primary)",
            color: "var(--ink)",
          }}
          role="alert"
        >
          <Alert className="mt-0.5 shrink-0" style={{ fontSize: "1.05em" }} />
          <div>
            Could not find data for {missing.map((a, i) => (
              <span key={a.name}>
                {i > 0 ? (i === missing.length - 1 ? " or " : ", ") : ""}
                <strong>{a.name}</strong>
              </span>
            ))}.{" "}
            {missing.length === 1 && missing[0].name === "Claude Code" ? (
              <>
                Set <code className="mono">CLAUDE_DIR</code> to point at your
                Claude Code config directory.
              </>
            ) : (
              <>
                Set each tool&apos;s config directory env var (e.g.{" "}
                <code className="mono">CLAUDE_DIR</code>) to point at its data.
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-3 w-3 shrink-0 rounded-full"
              style={{
                background: "var(--cta)",
                border: "2px solid var(--text)",
                boxShadow: "0 0 0 0 var(--cta)",
                animation: "pulse 2.4s cubic-bezier(0.4,0,0.6,1) infinite",
              }}
              aria-hidden
            />
            <h1
              className="text-2xl font-extrabold tracking-tight"
              style={{ color: "var(--text)" }}
            >
              <span
                className="px-1.5 py-0.5"
                style={{
                  background: "var(--accent-mint)",
                  border: "3px solid var(--text)",
                  borderRadius: "8px",
                  boxShadow: "3px 3px 0 var(--shadow-hard)",
                  display: "inline-block",
                }}
              >
                Claude
              </span>{" "}
              <span>Code usage</span>
            </h1>
          </div>
          <p
            className="mt-2 text-xs font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            Live read of <code className="mono">~/.claude/projects</code> · updated{" "}
            <time
              dateTime={generatedAt}
              className="tabular"
              style={{ color: "var(--text)" }}
            >
              {new Date(generatedAt).toLocaleTimeString("en-US")}
            </time>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh usage data"
            className="btn-primary clay-press inline-flex items-center gap-1.5 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Refresh
              className={refreshing ? "animate-spin" : ""}
              style={{ fontSize: "0.95em" }}
            />
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cta) 50%, transparent); }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </header>
  );
}