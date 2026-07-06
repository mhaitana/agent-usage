// OpenCode (SST `sst/opencode` CLI) adapter.
//
// OpenCode stores its session history in a SQLite database at
//   ~/.local/share/opencode/opencode.db  (WAL mode; overridable via OPENCODE_DIR)
// rather than JSONL. The `session` table carries per-session aggregates for
// everything we need: token counts (input/output/reasoning/cache_read/cache_write),
// cost, model (a JSON string {id, providerID, variant}), the working `directory`,
// title, agent, and ms-epoch timestamps. `message` + `part` tables give message
// and tool-call counts via subquery. We deliberately read only these three tables
// — the `event` table's per-step deltas and the `snapshot`/`session_diff` blob
// stores add no token data the `session` aggregate doesn't already have.
//
// We open the db read-only with better-sqlite3 so a live OpenCode process can
// keep writing (SQLite WAL allows readonly readers concurrent with the writer).
//
// Cost caveat: OpenCode stores `cost: 0` whenever the model is routed through a
// provider it has no price table for (e.g. an OLLAMA proxy fronting glm-5.2 or
// kimi-k2.7-code, as on this machine). When `cost` is 0 we recompute from
// tokens via lib/pricing/opencode.ts, which delegates to the existing Anthropic
// + OpenAI rate tables and falls back to an honest $0 for unknown models.
//
// Token taxonomy mapping (OpenCode → normalized Anthropic-shaped Session):
//   inputTokens         = tokens_input               (excludes cache — matches)
//   cacheReadTokens     = tokens_cache_read
//   cacheCreationTokens = tokens_cache_write         (cache write ≈ creation)
//   outputTokens        = tokens_output + tokens_reasoning   (reasoning bundled in)
//   totalTokens         = input + cacheRead + cacheWrite + output + reasoning
// Per-model attribution: the `session` table is an aggregate with one primary
// `model`, so a session's totals attribute to that single model. A session that
// switched models mid-run can't be split from this table — the `event` table's
// per-step deltas lack a reliable per-step model, so splitting isn't sound.
//
// Subagents: rows with a `parent_id` are sub-sessions with their own token
// totals. V1 includes them flat; a future `parent_id`-aware grouping could
// indent them under their parent (ccusage does this).

import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { tilde } from "@/lib/format";
import { costOf } from "@/lib/pricing/opencode";
import type { ModelTokens, Session } from "@/lib/types";
import type { Adapter, DiscoveredSession } from "./types";

// --- paths ----------------------------------------------------------------

/** Root OpenCode data directory, e.g. /Users/you/.local/share/opencode. */
function opencodeDir(): string {
  // Allow override via env for testing / alternate installs.
  return process.env.OPENCODE_DIR || join(homedir(), ".local", "share", "opencode");
}

function dbPath(): string {
  return join(opencodeDir(), "opencode.db");
}

// --- project naming -------------------------------------------------------

function humanizeProject(cwd: string | null | undefined): string {
  if (!cwd) return "opencode";
  // OpenCode records the real `directory`; the basename is the project name.
  // Same as Codex — nothing to strip.
  return basename(cwd) || "opencode";
}

// --- loose shapes for the raw SQLite rows ---------------------------------

interface SessionRow {
  id: string;
  directory: string;
  title: string | null;
  agent: string | null;
  model: string | null; // JSON string: { id, providerID, variant }
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  time_created: number | null; // ms epoch
  time_updated: number | null; // ms epoch
}

interface OpenCodeModelMeta {
  id?: string;
  providerID?: string;
  variant?: string;
}

// --- helpers --------------------------------------------------------------

function num(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Parse the `model` JSON column → model id string. Falls back to "opencode"
 *  when the column is empty/malformed (one session on this machine has no model). */
function modelName(raw: string | null | undefined): string {
  if (!raw) return "opencode";
  try {
    const m = JSON.parse(raw) as OpenCodeModelMeta;
    const id = m?.id?.trim();
    return id || "opencode";
  } catch {
    return "opencode";
  }
}

/** Open the db read-only. WAL mode lets us read concurrently with a live
 *  OpenCode writer. Returns null if the db can't be opened. */
function openDb(): Database.Database | null {
  try {
    return new Database(dbPath(), { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

// --- parsing --------------------------------------------------------------

/** Query one session row by id + its message/tool-call counts. Returns null if
 *  the row is missing. */
function loadSession(db: Database.Database, sessionId: string): Session | null {
  const row = db
    .prepare<
      [string],
      SessionRow
    >(`SELECT id, directory, title, agent, model, cost,
              tokens_input, tokens_output, tokens_reasoning,
              tokens_cache_read, tokens_cache_write,
              time_created, time_updated
       FROM session WHERE id = ?`)
    .get(sessionId);
  if (!row) return null;

  const messageCount = num(
    db
      .prepare<[string], { c: number }>(
        `SELECT count(*) AS c FROM message WHERE session_id = ?`,
      )
      .get(sessionId)?.c,
  );
  const toolCallCount = num(
    db
      .prepare<[string], { c: number }>(
        `SELECT count(*) AS c FROM part
         WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'`,
      )
      .get(sessionId)?.c,
  );

  return toSession(row, messageCount, toolCallCount);
}

/** Map a session row into the normalized Session shape. */
function toSession(
  row: SessionRow,
  messageCount: number,
  toolCallCount: number,
): Session {
  const model = modelName(row.model);

  const inputTokens = num(row.tokens_input);
  const cacheReadTokens = num(row.tokens_cache_read);
  const cacheCreationTokens = num(row.tokens_cache_write);
  const outputTokens = num(row.tokens_output) + num(row.tokens_reasoning);
  const totalTokens =
    inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;

  // Use OpenCode's stored cost when it has pricing; otherwise recompute from
  // tokens. Unknown models (proxy-routed) → costOf returns 0 → honest $0.
  const storedCost = num(row.cost);
  const cost =
    storedCost > 0
      ? storedCost
      : costOf({
          model,
          inputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          outputTokens,
        });

  // V1: attribute the whole session to its primary model.
  const byModel: ModelTokens[] = [
    {
      model,
      inputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      outputTokens,
      totalTokens,
      cost,
      messageCount,
      toolCallCount,
    },
  ];

  const firstSeen = isoFromMs(row.time_created);
  const lastSeen = isoFromMs(row.time_updated);

  return {
    sessionId: row.id,
    adapter: "opencode",
    project: humanizeProject(row.directory),
    cwd: row.directory ?? null,
    title: row.title || null,
    models: [model],
    firstSeen,
    lastSeen,
    durationMs: durationMs(firstSeen, lastSeen),
    messageCount,
    toolCallCount,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens,
    cost,
    byModel,
  };
}

function isoFromMs(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function durationMs(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, b - a);
}

// --- adapter --------------------------------------------------------------

export const opencodeAdapter: Adapter = {
  name: "OpenCode",
  slug: "opencode",
  hasTokenData: true,

  dirLabel(): string {
    return tilde(dbPath());
  },

  async isAvailable(): Promise<boolean> {
    try {
      await stat(dbPath());
      return true;
    } catch {
      return false;
    }
  },

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const db = openDb();
    if (!db) return [];
    try {
      const rows = db.prepare<[], { id: string }>(`SELECT id FROM session`).all();
      const p = dbPath();
      // One DiscoveredSession per session row. `key` is unique per session
      // (dbPath#id); `path` is the shared db file so the orchestrator's
      // stat(path) mtime/size cache invalidates every row together when the
      // db changes. parseSession recovers the id by splitting on "#".
      return rows.map((r) => ({
        key: `${p}#${r.id}`,
        path: p,
        projectSlug: "",
      }));
    } finally {
      db.close();
    }
  },

  async parseSession(discovered: DiscoveredSession): Promise<Session | null> {
    const sessionId = discovered.key.split("#", 2)[1] ?? "";
    if (!sessionId) return null;
    const db = openDb();
    if (!db) return null;
    try {
      return loadSession(db, sessionId);
    } finally {
      db.close();
    }
  },
};