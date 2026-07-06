// Codex (OpenAI coding agent) adapter.
//
// Owns everything Codex-specific:
//   - where Codex stores sessions (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//     and ~/.codex/archived_sessions/rollout-*.jsonl, overridable via CODEX_DIR),
//   - the rollout JSONL record format (type === "session_meta" | "turn_context"
//     | "event_msg" | "response_item" | "compacted"),
//   - deriving project names from the session's cwd basename,
//   - session titles from ~/.codex/session_index.jsonl,
//   - OpenAI API-price-equivalent cost (lib/pricing/openai.ts).
//
// The orchestrator (lib/usage-data.ts) handles the mtime cache + aggregation,
// so this file is pure extraction.
//
// Token taxonomy mapping (Codex → normalized Anthropic-shaped Session):
//   inputTokens        = input_tokens - cached_input_tokens   (non-cached input)
//   cacheReadTokens    = cached_input_tokens
//   cacheCreationTokens = 0   (Codex exposes no cache-creation field)
//   outputTokens       = output_tokens   (reasoning_output_tokens is bundled in)
// Per-model attribution: each token_count's last_token_usage delta is added to
// the accumulator for currentModel (the most recent turn_context.payload.model,
// which precedes its turn's token_count records). last_token_usage is a
// per-response DELTA (verified), so summing deltas yields the true per-session
// total without double-counting cached input.

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { costOf } from "@/lib/pricing/openai";
import { tilde } from "@/lib/format";
import type { Session } from "@/lib/types";
import type { Adapter, DiscoveredSession } from "./types";

// --- paths ----------------------------------------------------------------

/** Root Codex config directory, e.g. /Users/you/.codex. */
function codexDir(): string {
  // Allow override via env for testing / alternate installs.
  return process.env.CODEX_DIR || join(homedir(), ".codex");
}

function sessionsDir(): string {
  return join(codexDir(), "sessions");
}

function archivedDir(): string {
  return join(codexDir(), "archived_sessions");
}

function indexPath(): string {
  return join(codexDir(), "session_index.jsonl");
}

// --- project naming -------------------------------------------------------

function humanizeProject(cwd: string | null | undefined): string {
  if (!cwd) return "codex";
  // Codex records the real cwd; the basename is the project name. Unlike
  // Claude's slug humanizing, there's nothing to strip.
  return basename(cwd) || "codex";
}

// --- session_index.jsonl title map (process-local mtime cache) -----------

let indexCache: { mtimeMs: number; size: number; map: Map<string, string> } | null = null;

async function loadSessionIndex(): Promise<Map<string, string> | null> {
  const p = indexPath();
  let st;
  try {
    st = await stat(p);
  } catch {
    return null;
  }
  if (
    indexCache &&
    indexCache.mtimeMs === st.mtimeMs &&
    indexCache.size === st.size
  ) {
    return indexCache.map;
  }
  const map = new Map<string, string>();
  const stream = createReadStream(p, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const r = JSON.parse(trimmed) as { id?: unknown; thread_name?: unknown };
      if (r && typeof r.id === "string" && typeof r.thread_name === "string") {
        map.set(r.id, r.thread_name);
      }
    } catch {
      continue; // defensive: skip malformed lines
    }
  }
  indexCache = { mtimeMs: st.mtimeMs, size: st.size, map };
  return map;
}

// --- loose shapes for the raw JSONL records ------------------------------

interface CodexPayload {
  type?: string;
  cwd?: string;
  /** Session id. Newer Codex versions emit both `id` and `session_id`; older
   *  ones only emit `id`. Read via `id ?? session_id` at the call site. */
  id?: string;
  session_id?: string;
  model?: string;
  info?: {
    last_token_usage?: {
      input_tokens?: number;
      cached_input_tokens?: number;
      output_tokens?: number;
      reasoning_output_tokens?: number;
      total_tokens?: number;
    };
    total_token_usage?: Record<string, number>;
  };
  [key: string]: unknown;
}

interface CodexRecord {
  type?: string;
  timestamp?: string;
  payload?: CodexPayload;
}

// --- per-session accumulator ---------------------------------------------

interface AccModel {
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface AccSession {
  sessionId: string;
  cwd: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  currentModel: string | null;
  models: Map<string, AccModel>;
  modelOrder: string[];
  messageCount: number; // user_message count (session-level)
  toolCallCount: number; // session total = sum of per-model (derived in toSession)
}

function emptyAccModel(model: string): AccModel {
  return {
    model,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    messageCount: 0,
    toolCallCount: 0,
  };
}

function initAcc(sessionId: string | undefined, cwd: string | undefined): AccSession {
  return {
    sessionId: sessionId || "(unknown)",
    cwd: cwd ?? null,
    firstSeen: null,
    lastSeen: null,
    currentModel: null,
    models: new Map(),
    modelOrder: [],
    messageCount: 0,
    toolCallCount: 0,
  };
}

function bumpTimestamp(acc: AccSession, ts: string | null | undefined) {
  if (!ts) return;
  if (!acc.firstSeen || ts < acc.firstSeen) acc.firstSeen = ts;
  if (!acc.lastSeen || ts > acc.lastSeen) acc.lastSeen = ts;
}

function num(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Get or create the per-model accumulator, preserving encounter order. */
function modelAcc(acc: AccSession, model: string): AccModel {
  let m = acc.models.get(model);
  if (!m) {
    m = emptyAccModel(model);
    acc.models.set(model, m);
    acc.modelOrder.push(model);
  }
  return m;
}

// --- parsing --------------------------------------------------------------

/** Parse a single rollout JSONL file into an accumulator (or null if no
 *  session_meta / no usable records). */
async function parseSessionFile(filePath: string): Promise<AccSession | null> {
  let acc: AccSession | null = null;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: CodexRecord;
    try {
      rec = JSON.parse(trimmed) as CodexRecord;
    } catch {
      continue; // defensive: skip malformed lines
    }
    if (!rec || typeof rec !== "object") continue;

    const outer = rec.type;
    const ts: string | undefined = rec.timestamp;
    const payload = rec.payload;

    if (outer === "session_meta") {
      if (!acc) {
        // Newer Codex emits both id and session_id; older emits only id.
        const sid = payload?.id ?? payload?.session_id;
        acc = initAcc(sid, payload?.cwd);
      } else if (!acc.cwd && payload?.cwd) {
        acc.cwd = payload.cwd;
      }
      bumpTimestamp(acc, ts);
      continue;
    }

    if (!acc) continue; // ignore records before the session_meta
    if (outer === "turn_context") {
      if (payload?.model) acc.currentModel = payload.model;
      bumpTimestamp(acc, ts);
      continue;
    }

    // token_count / messages / tool calls live in the payload.type of
    // event_msg and response_item records.
    const ptype = payload?.type;
    if (ptype === "token_count") {
      const last = payload?.info?.last_token_usage;
      if (!last) continue;
      if (!acc.currentModel) continue; // no turn_context yet — can't attribute
      const m = modelAcc(acc, acc.currentModel);
      const cached = num(last.cached_input_tokens);
      m.inputTokens += Math.max(0, num(last.input_tokens) - cached);
      m.cacheReadTokens += cached;
      m.outputTokens += num(last.output_tokens);
      bumpTimestamp(acc, ts);
      continue;
    }

    if (ptype === "user_message") {
      acc.messageCount += 1;
      bumpTimestamp(acc, ts);
      continue;
    }
    if (ptype === "agent_message") {
      if (acc.currentModel) modelAcc(acc, acc.currentModel).messageCount += 1;
      bumpTimestamp(acc, ts);
      continue;
    }
    if (ptype === "custom_tool_call" || ptype === "function_call") {
      if (acc.currentModel) modelAcc(acc, acc.currentModel).toolCallCount += 1;
      bumpTimestamp(acc, ts);
      continue;
    }
    // Everything else (reasoning, *_output, patch_apply_*, task_*, web_search,
    // context_compacted, …) is ignored for usage purposes.
  }

  return acc;
}

/** Map a per-session accumulator into the normalized Session shape. */
function toSession(acc: AccSession, titles: Map<string, string> | null): Session {
  const byModel = acc.modelOrder.map((modelId) => {
    const m = acc.models.get(modelId)!;
    const totalTokens = m.inputTokens + m.cacheReadTokens + m.outputTokens;
    return {
      model: modelId,
      inputTokens: m.inputTokens,
      cacheCreationTokens: 0, // Codex exposes no cache-creation field
      cacheReadTokens: m.cacheReadTokens,
      outputTokens: m.outputTokens,
      totalTokens,
      cost: costOf({
        model: modelId,
        inputTokens: m.inputTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
      }),
      messageCount: m.messageCount,
      toolCallCount: m.toolCallCount,
    };
  });

  const inputTokens = sum(byModel, "inputTokens");
  const cacheReadTokens = sum(byModel, "cacheReadTokens");
  const outputTokens = sum(byModel, "outputTokens");
  const totalTokens = inputTokens + cacheReadTokens + outputTokens;
  const cost = sum(byModel, "cost");
  const toolCallCount = sum(byModel, "toolCallCount");

  return {
    sessionId: acc.sessionId,
    adapter: "codex",
    project: humanizeProject(acc.cwd),
    cwd: acc.cwd,
    title: titles?.get(acc.sessionId) ?? null,
    models: acc.modelOrder.slice(),
    firstSeen: acc.firstSeen,
    lastSeen: acc.lastSeen,
    durationMs: durationMs(acc.firstSeen, acc.lastSeen),
    messageCount: acc.messageCount + sum(byModel, "messageCount"),
    toolCallCount,
    inputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens,
    outputTokens,
    totalTokens,
    cost,
    byModel,
  };
}

function sum<T>(arr: T[], key: keyof T): number {
  let total = 0;
  for (const item of arr) total += Number(item[key]) || 0;
  return total;
}

function durationMs(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, b - a);
}

// --- discovery ------------------------------------------------------------

/** Recursively collect *.jsonl files under dir (Codex nests sessions as
 *  YYYY/MM/DD/). Returns [] if the dir is missing. */
async function walkJsonl(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkJsonl(p)));
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      out.push(p);
    }
  }
  return out;
}

// --- adapter --------------------------------------------------------------

export const codexAdapter: Adapter = {
  name: "Codex",
  slug: "codex",
  hasTokenData: true,

  dirLabel(): string {
    return tilde(sessionsDir());
  },

  async isAvailable(): Promise<boolean> {
    try {
      await stat(codexDir());
      return true;
    } catch {
      return false;
    }
  },

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const files = new Set<string>([
      ...(await walkJsonl(sessionsDir())),
      ...(await walkJsonl(archivedDir())),
    ]);
    const out: DiscoveredSession[] = [];
    for (const filePath of files) {
      // projectSlug is unused by this adapter — project is derived from the
      // session's cwd at parse time. The interface field is required, so "".
      out.push({ key: filePath, path: filePath, projectSlug: "" });
    }
    return out;
  },

  async parseSession(discovered: DiscoveredSession): Promise<Session | null> {
    const acc = await parseSessionFile(discovered.path);
    if (!acc) return null;
    if (acc.modelOrder.length === 0) return null; // no token_count records
    const titles = await loadSessionIndex();
    return toSession(acc, titles);
  },
};