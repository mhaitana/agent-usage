"use client";

import { useMemo, useState } from "react";
import type { Session } from "@/lib/types";
import { buildColorMap } from "@/lib/palette";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatFullTokens,
  formatTokens,
} from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Search, SortArrow } from "@/components/ui/icons";

type SortKey =
  | "lastSeen"
  | "project"
  | "title"
  | "models"
  | "messageCount"
  | "toolCallCount"
  | "totalTokens"
  | "cost"
  | "durationMs";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; sortable: boolean }[] = [
  { key: "lastSeen", label: "Last seen", align: "left", sortable: true },
  { key: "project", label: "Project", align: "left", sortable: true },
  { key: "title", label: "Title", align: "left", sortable: true },
  { key: "models", label: "Models", align: "left", sortable: false },
  { key: "messageCount", label: "Msgs", align: "right", sortable: true },
  { key: "toolCallCount", label: "Tools", align: "right", sortable: true },
  { key: "totalTokens", label: "Tokens", align: "right", sortable: true },
  { key: "cost", label: "Est. cost", align: "right", sortable: true },
  { key: "durationMs", label: "Duration", align: "right", sortable: true },
];

const INITIAL_PAGE_SIZE = 25;

export default function SessionTable({
  sessions,
  tokenLessAdapters,
}: {
  sessions: Session[];
  /** Adapter slugs that don't expose token/cost data. On a mixed table
   *  (overview) their rows render "—" in the Tokens/Est. cost cells; on an
   *  all-token-less table (per-agent /antigravity) those columns are dropped. */
  tokenLessAdapters?: Set<string>;
}) {
  const allTokenLess =
    sessions.length > 0 &&
    (tokenLessAdapters
      ? sessions.every((s) => tokenLessAdapters.has(s.adapter))
      : false);
  // Drop the Tokens + Est. cost columns when every row is token-less; else
  // keep them (mixed overview) and render "—" per token-less row.
  const columns = allTokenLess
    ? COLUMNS.filter((c) => c.key !== "totalTokens" && c.key !== "cost")
    : COLUMNS;
  const [sortKey, setSortKey] = useState<SortKey>(
    allTokenLess ? "toolCallCount" : "totalTokens",
  );
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(INITIAL_PAGE_SIZE);

  const isTokenLess = (a: string) => !!tokenLessAdapters?.has(a);

  // One stable model→color map across all sessions (sorted, same rule as charts).
  const allModels = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) for (const m of s.models) set.add(m);
    return [...set].sort();
  }, [sessions]);
  const colorMap = useMemo(() => buildColorMap(allModels), [allModels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const hay = [s.project, s.title ?? "", s.models.join(" "), s.cwd ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "models":
          cmp = a.models.join(",").localeCompare(b.models.join(","));
          break;
        case "project":
          cmp = a.project.localeCompare(b.project);
          break;
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "lastSeen":
          cmp = (a.lastSeen ?? "").localeCompare(b.lastSeen ?? "");
          break;
        default:
          cmp = Number(a[sortKey]) - Number(b[sortKey]);
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, dir]);

  function onHeaderClick(key: SortKey, sortable: boolean) {
    if (!sortable) return;
    if (sortKey === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(key === "lastSeen" || key === "title" || key === "project" ? "asc" : "desc");
    }
  }

  const visible = sorted.slice(0, limit);
  const hasMore = sorted.length > limit;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <CardHeader
          title="Sessions"
          className="mb-0"
          action={
            <span className="tabular" style={{ color: "var(--text-muted)" }}>
              {filtered.length}
              {filtered.length !== sessions.length ? ` of ${sessions.length}` : ""}
            </span>
          }
        />
        <div
          className="clay-chip flex items-center gap-2 px-3 py-1.5 transition-colors focus-within:border-[var(--cta)]"
          style={{
            background: "var(--bg-sunken)",
          }}
        >
          <Search style={{ fontSize: "0.9em", color: "var(--text-muted)" }} />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(INITIAL_PAGE_SIZE);
            }}
            placeholder="Filter by project, title, model…"
            aria-label="Filter sessions"
            className="w-44 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)] sm:w-56"
            style={{ color: "var(--text)" }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear filter"
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {query ? `No sessions match “${query}”.` : "No sessions yet."}
        </div>
      ) : (
        <>
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">
                Agent sessions, sortable by last seen, project, title, models,
                messages, tool calls
                {allTokenLess ? "" : ", tokens, cost"}, and duration.
              </caption>
              <thead
                className="sticky top-0 z-10"
                style={{ background: "var(--bg)" }}
              >
                <tr style={{ borderBottom: "2px solid var(--text)" }}>
                  {columns.map((c) => {
                    const isSorted = sortKey === c.key;
                    const ariaSort = !c.sortable
                      ? "none"
                      : isSorted
                        ? dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none";
                    return (
                      <th
                        key={c.key}
                        aria-sort={ariaSort as "none" | "ascending" | "descending"}
                        style={{ textAlign: c.align }}
                        className="px-3 py-2 font-medium"
                      >
                        {c.sortable ? (
                          <button
                            type="button"
                            onClick={() => onHeaderClick(c.key, c.sortable)}
                            className="inline-flex items-center gap-1 rounded px-0.5 py-0.5 transition-colors duration-150 hover:bg-[var(--bg-sunken)]"
                            style={{
                              color: isSorted ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              userSelect: "none",
                              whiteSpace: "nowrap",
                            }}
                            aria-label={`Sort by ${c.label}${
                              isSorted ? ` (${dir === "asc" ? "ascending" : "descending"})` : ""
                            }`}
                          >
                            <span>{c.label}</span>
                            {isSorted ? (
                              <SortArrow dir={dir} style={{ color: "var(--text-muted)" }} />
                            ) : (
                              <span style={{ opacity: 0.3 }}>
                                <SortArrow dir="desc" />
                              </span>
                            )}
                          </button>
                        ) : (
                          <span
                            style={{
                              color: "var(--text-muted)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.label}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.sessionId} className="session-row">
                    <td
                      className="px-3 py-2 whitespace-nowrap"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {formatDate(s.lastSeen)}
                    </td>
                    <td
                      className="px-3 py-2 font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {s.project}
                    </td>
                    <td
                      className="max-w-[280px] truncate px-3 py-2"
                      title={s.title ?? ""}
                      style={{ color: "var(--text-muted)" }}
                    >
                      {s.title ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {s.models.map((m) => (
                          <span
                            key={m}
                            className="inline-block px-1.5 py-0.5 text-[10px] font-extrabold"
                            style={{
                              background: `color-mix(in srgb, ${colorMap.get(m)} 22%, var(--bg))`,
                              color: "var(--text)",
                              borderRadius: "var(--radius-pill)",
                              border: "2px solid var(--text)",
                            }}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-muted)" }}>
                      {s.messageCount.toLocaleString()}
                    </td>
                    <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-muted)" }}>
                      {s.toolCallCount.toLocaleString()}
                    </td>
                    <td
                      className="tabular px-3 py-2 text-right font-medium"
                      style={{ color: "var(--text)" }}
                      title={isTokenLess(s.adapter) ? undefined : formatFullTokens(s.totalTokens)}
                    >
                      {isTokenLess(s.adapter) ? (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      ) : (
                        formatTokens(s.totalTokens)
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right font-medium" style={{ color: "var(--text)" }}>
                      {isTokenLess(s.adapter) ? (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      ) : (
                        formatCost(s.cost)
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-muted)" }}>
                      {formatDuration(s.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div
              className="flex items-center justify-center border-t-[3px] px-4 py-3"
              style={{ borderColor: "var(--text)" }}
            >
              <button
                type="button"
                onClick={() => setLimit((l) => l + 50)}
                className="btn-secondary clay-press px-4 py-2 text-xs"
              >
                Show {sorted.length - limit} more of {sorted.length}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}