"use client";

import { useMemo, useState } from "react";
import type { Session } from "@/lib/types";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatFullTokens,
  formatTokens,
} from "@/lib/format";

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

export default function SessionTable({ sessions }: { sessions: Session[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...sessions];
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
  }, [sessions, sortKey, dir]);

  function onHeaderClick(key: SortKey, sortable: boolean) {
    if (!sortable) return;
    if (sortKey === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(key === "lastSeen" || key === "title" || key === "project" ? "asc" : "desc");
    }
  }

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ background: "var(--surface-1)", borderColor: "var(--border-ring)" }}
    >
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Sessions
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {sessions.length} total
        </span>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead
            className="sticky top-0 z-10"
            style={{ background: "var(--surface-1)" }}
          >
            <tr style={{ borderBottom: "1px solid var(--border-ring)" }}>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onHeaderClick(c.key, c.sortable)}
                  className="px-3 py-2 font-medium"
                  style={{
                    textAlign: c.align,
                    color: "var(--text-secondary)",
                    cursor: c.sortable ? "pointer" : "default",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.sortable && sortKey === c.key && (
                      <span style={{ color: "var(--text-muted)" }}>
                        {dir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.sessionId}
                style={{ borderBottom: "1px solid var(--gridline)" }}
              >
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                  {formatDate(s.lastSeen)}
                </td>
                <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                  {s.project}
                </td>
                <td
                  className="max-w-[280px] truncate px-3 py-2"
                  title={s.title ?? ""}
                  style={{ color: "var(--text-secondary)" }}
                >
                  {s.title ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>
                <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                  {s.models.map((m) => (
                    <span
                      key={m}
                      className="mr-1 inline-block rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      {m}
                    </span>
                  ))}
                </td>
                <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                  {s.messageCount.toLocaleString()}
                </td>
                <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                  {s.toolCallCount.toLocaleString()}
                </td>
                <td
                  className="tabular px-3 py-2 text-right"
                  style={{ color: "var(--text-primary)" }}
                  title={formatFullTokens(s.totalTokens)}
                >
                  {formatTokens(s.totalTokens)}
                </td>
                <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-primary)" }}>
                  {formatCost(s.cost)}
                </td>
                <td className="tabular px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatDuration(s.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}