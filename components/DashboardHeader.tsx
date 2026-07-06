"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Refresh, Alert } from "@/components/ui/icons";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import type { AdapterStatus } from "@/lib/types";

/**
 * Dashboard top bar: product title, a live "updated" indicator with a soft
 * pulse, a scope switcher (Overview + one pill per registered agent), and a
 * refresh action that re-runs the server data fetch. Local-only — refresh
 * just re-reads each adapter's data dir on the server.
 *
 * The hero band (cream background, decorative shape accents, max-width
 * container) lives here so both the overview and per-agent pages share the
 * same chrome by mounting this one component.
 */
export default function DashboardHeader({
  badge,
  titleTail,
  subtitle,
  adapters,
  activeSlug,
  generatedAt,
}: {
  badge: string;
  titleTail: string;
  subtitle: string;
  adapters: AdapterStatus[];
  /** null = overview (the Overview pill is active). */
  activeSlug: string | null;
  generatedAt: string;
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

  // Nav targets: Overview first, then one per registered adapter (in registry
  // order, which matches the adapters status array).
  const navItems: { label: string; href: string; active: boolean }[] = [
    { label: "Overview", href: "/", active: activeSlug === null },
    ...adapters.map((a) => ({
      label: a.name,
      href: `/${a.slug}`,
      active: activeSlug === a.slug,
    })),
  ];

  return (
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
              Could not find data for{" "}
              {missing.map((a, i) => (
                <span key={a.slug}>
                  {i > 0 ? (i === missing.length - 1 ? " or " : ", ") : ""}
                  <strong>{a.name}</strong>
                </span>
              ))}
              .{" "}
              {missing.length === 1 && missing[0].name === "Claude Code" ? (
                <>
                  Set <code className="mono">CLAUDE_DIR</code> to point at your
                  Claude Code config directory.
                </>
              ) : (
                <>
                  Set each tool&apos;s config directory env var (e.g.{" "}
                  <code className="mono">CLAUDE_DIR</code>,{" "}
                  <code className="mono">CODEX_DIR</code>) to point at its data.
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
                  {badge}
                </span>{" "}
                <span>{titleTail}</span>
              </h1>
            </div>
            {activeSlug !== null && (
              <p
                className="mt-2 text-xs font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                Live read of <code className="mono">{subtitle}</code> · updated{" "}
                <time
                  dateTime={generatedAt}
                  className="tabular"
                  style={{ color: "var(--text)" }}
                >
                  {new Date(generatedAt).toLocaleTimeString("en-US")}
                </time>
              </p>
            )}
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

        {/* Scope switcher — Overview + one pill per agent. Active pill is
            pressed clay; inactive are sunken. */}
        <nav
          className="mt-5 flex flex-wrap gap-2"
          aria-label="Agent scope"
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className="pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
              style={{
                background: item.active
                  ? "var(--primary)"
                  : "var(--bg-sunken)",
                color: item.active ? "var(--ink)" : "var(--text-muted)",
                boxShadow: item.active
                  ? "3px 3px 0 var(--shadow-hard)"
                  : "none",
                transform: item.active ? "translate(0, 0)" : "none",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <style>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cta) 50%, transparent); }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </div>
  );
}