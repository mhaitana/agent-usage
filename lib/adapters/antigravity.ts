// Google Antigravity adapter — activity-only.
//
// Antigravity stores conversation history on disk, but it does NOT persist
// per-request token usage or cost anywhere local — usage accounting is
// server-side at Google, and external requests are forbidden by this app's
// "local only" constraint. So this adapter reports real sessions, projects,
// models, timestamps, message counts, and tool-call counts, but honestly
// zeros out every token + cost field (`hasTokenData: false`). The UI swaps
// the token/cost panels for activity panels on /antigravity accordingly.
//
// Source of truth: the human-readable JSONL transcripts under
//   ~/.gemini/antigravity-ide/brain/<uuid>/.system_generated/logs/transcript_full.jsonl
//   (falling back to transcript.jsonl when _full is absent)
// We deliberately do NOT parse the SQLite ~/.gemini/antigravity-ide/conversations/<uuid>.db
// files — they're large, partially encrypted protobuf blobs, and carry no
// token data the transcripts don't. The brain-dir UUID is the session id.
//
// Overridable via ANTIGRAVITY_DIR (mirrors CLAUDE_DIR / CODEX_DIR). When the
// override is unset, we also scan the legacy ~/.gemini/antigravity/brain tree
// for pre-IDE-split data; with an override we scan only it (avoid duplicates).

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { tilde } from "@/lib/format";
import type { ModelTokens, Session } from "@/lib/types";
import type { Adapter, DiscoveredSession } from "./types";

// --- paths ----------------------------------------------------------------

/** Root Antigravity-IDE config directory, e.g. /Users/you/.gemini/antigravity-ide. */
function antigravityDir(): string {
  return process.env.ANTIGRAVITY_DIR || join(homedir(), ".gemini", "antigravity-ide");
}

function brainDir(): string {
  return join(antigravityDir(), "brain");
}

/** Pre-IDE-split brain tree (~/.gemini/antigravity/brain). Only scanned when
 *  no ANTIGRAVITY_DIR override is set. */
function legacyBrainDir(): string {
  return join(homedir(), ".gemini", "antigravity", "brain");
}

// --- project naming -------------------------------------------------------

function humanizeProject(cwd: string | null | undefined): string {
  if (!cwd) return "antigravity";
  // Antigravity records the real cwd; the basename is the project name.
  return basename(cwd) || "antigravity";
}

// --- loose shapes for the raw JSONL records -------------------------------

interface AntiToolCall {
  name?: unknown;
  [key: string]: unknown;
}

interface AntiRecord {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  tool_calls?: AntiToolCall[];
  [key: string]: unknown;
}

// --- per-session accumulator ----------------------------------------------

interface AccSession {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  models: string[]; // encounter order
  modelSet: Set<string>;
  messageCount: number; // USER_INPUT count
  toolCallCount: number;
  recordCount: number;
}

function initAcc(sessionId: string): AccSession {
  return {
    sessionId,
    cwd: null,
    title: null,
    firstSeen: null,
    lastSeen: null,
    models: [],
    modelSet: new Set(),
    messageCount: 0,
    toolCallCount: 0,
    recordCount: 0,
  };
}

function bumpTimestamp(acc: AccSession, ts: string | null | undefined) {
  if (!ts) return;
  if (!acc.firstSeen || ts < acc.firstSeen) acc.firstSeen = ts;
  if (!acc.lastSeen || ts > acc.lastSeen) acc.lastSeen = ts;
}

function addModel(acc: AccSession, model: string | null | undefined) {
  if (!model) return;
  const clean = model.trim();
  if (!clean) return;
  if (!acc.modelSet.has(clean)) {
    acc.modelSet.add(clean);
    acc.models.push(clean);
  }
}

// Records whose `type` represents a tool execution even without a tool_calls[]
// array. Each counts as one tool call.
const TOOL_EXEC_TYPES = new Set([
  "RUN_COMMAND",
  "CODE_ACTION",
  "VIEW_FILE",
  "GREP_SEARCH",
  "LIST_DIRECTORY",
  "SEARCH_WEB",
]);

// --- parsing --------------------------------------------------------------

/** Pull the model name out of a `<USER_SETTINGS_CHANGE>…to <Model>` block.
 *  Captures lazily up to a tier parenthesis " (", a sentence-ending ". ", a
 *  newline, or a tag — so model names containing dots (e.g. "Gemini 3.1 Pro")
 *  survive intact. */
const MODEL_CHANGE_RE = /to\s+(Gemini.+?)(?:\s*\(|\.\s|\n|<)/i;
/** `CWD: /path` inside RUN_COMMAND content. Authoritative cwd source. */
const CWD_RE = /^CWD:\s*(.+)$/m;
/** `Active Document: /path` inside USER_INPUT metadata. Stops at `<` so it
 *  doesn't swallow a closing tag (whose `</…>` would corrupt basename). */
const ACTIVE_DOC_RE = /Active Document:\s*([^\s<]+)/;

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a transcript JSONL file into an accumulator (or null if empty). */
async function parseSessionFile(
  filePath: string,
  sessionId: string,
): Promise<AccSession | null> {
  const acc = initAcc(sessionId);

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: AntiRecord;
    try {
      rec = JSON.parse(trimmed) as AntiRecord;
    } catch {
      continue; // defensive: skip malformed lines
    }
    if (!rec || typeof rec !== "object") continue;
    acc.recordCount += 1;

    bumpTimestamp(acc, rec.created_at);

    const type = rec.type;
    const content = typeof rec.content === "string" ? rec.content : "";

    // Tool calls: explicit tool_calls[] array (PLANNER_RESPONSE, etc.).
    if (Array.isArray(rec.tool_calls)) {
      acc.toolCallCount += rec.tool_calls.length;
    }

    if (type === "USER_INPUT") {
      acc.messageCount += 1;

      // Model selection — the initial pick is recorded as a change from "None",
      // so most sessions expose their model here. The regex excludes the tier
      // parenthesis, so a trim is all that's needed.
      const modelMatch = content.match(MODEL_CHANGE_RE);
      if (modelMatch) addModel(acc, modelMatch[1].trim());

      // cwd candidate from the active document (a file path). Used only as a
      // fallback — RUN_COMMAND's CWD: line below is authoritative.
      if (!acc.cwd) {
        const doc = content.match(ACTIVE_DOC_RE);
        if (doc) acc.cwd = doc[1];
      }

      // Title from the first <USER_REQUEST> content.
      if (!acc.title) {
        const req = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
        if (req) {
          const t = stripTags(req[1]).slice(0, 100);
          if (t) acc.title = t;
        }
      }
    } else if (type === "RUN_COMMAND") {
      // CWD: line is the authoritative cwd — override the Active Document
      // fallback (CWD is the project dir; Active Document is a file).
      const cwdMatch = content.match(CWD_RE);
      if (cwdMatch) acc.cwd = cwdMatch[1].trim();
      // RUN_COMMAND without an explicit tool_calls[] still counts as a tool call.
      if (!Array.isArray(rec.tool_calls)) acc.toolCallCount += 1;
    } else if (TOOL_EXEC_TYPES.has(type ?? "")) {
      if (!Array.isArray(rec.tool_calls)) acc.toolCallCount += 1;
    }
  }

  if (acc.recordCount === 0) return null;
  // No model selection observed — fall back to a generic label so the session
  // still appears in by-model/project views. Activity data is still useful.
  if (acc.models.length === 0) addModel(acc, "Gemini");
  return acc;
}

/** Map a per-session accumulator into the normalized Session shape (tokens 0). */
function toSession(acc: AccSession): Session {
  // byModel: one entry per model, all token/cost fields 0. Attribute the
  // session's message/tool counts to the first model so per-session sums are
  // consistent with the Claude/Codex adapters (which spread them across models).
  const byModel: ModelTokens[] = acc.models.map((model, i) => ({
    model,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    messageCount: i === 0 ? acc.messageCount : 0,
    toolCallCount: i === 0 ? acc.toolCallCount : 0,
  }));

  return {
    sessionId: acc.sessionId,
    adapter: "antigravity",
    project: humanizeProject(acc.cwd),
    cwd: acc.cwd,
    title: acc.title,
    models: acc.models.slice(),
    firstSeen: acc.firstSeen,
    lastSeen: acc.lastSeen,
    durationMs: durationMs(acc.firstSeen, acc.lastSeen),
    messageCount: acc.messageCount,
    toolCallCount: acc.toolCallCount,
    // Antigravity keeps usage server-side — no on-disk token or cost data.
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    byModel,
  };
}

function durationMs(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, b - a);
}

// --- discovery ------------------------------------------------------------

/** Find the transcript file for one brain dir, preferring _full. Returns null
 *  if neither variant exists (the brain dir has no parseable transcript). */
async function findTranscript(uuidDir: string): Promise<string | null> {
  const logs = join(uuidDir, ".system_generated", "logs");
  const full = join(logs, "transcript_full.jsonl");
  try {
    await stat(full);
    return full;
  } catch {
    // fall through to transcript.jsonl
  }
  const plain = join(logs, "transcript.jsonl");
  try {
    await stat(plain);
    return plain;
  } catch {
    return null;
  }
}

/** Scan a brain dir for `<uuid>/.system_generated/logs/transcript*.jsonl`
 *  files. Returns [] if the dir is missing. */
async function discoverBrain(dir: string): Promise<DiscoveredSession[]> {
  const out: DiscoveredSession[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const uuidDir = join(dir, e.name);
    const transcript = await findTranscript(uuidDir);
    if (transcript) {
      // projectSlug is unused by this adapter — project is derived from cwd
      // at parse time. The interface field is required, so "".
      out.push({ key: transcript, path: transcript, projectSlug: "" });
    }
  }
  return out;
}

// --- adapter --------------------------------------------------------------

export const antigravityAdapter: Adapter = {
  name: "Antigravity",
  slug: "antigravity",
  hasTokenData: false,

  dirLabel(): string {
    return tilde(brainDir());
  },

  async isAvailable(): Promise<boolean> {
    try {
      await stat(brainDir());
      return true;
    } catch {
      return false;
    }
  },

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const files = await discoverBrain(brainDir());
    // Scan the legacy ~/.gemini/antigravity/brain tree too — but only when no
    // ANTIGRAVITY_DIR override is set (an override means "scan exactly here").
    if (!process.env.ANTIGRAVITY_DIR) {
      const legacy = await discoverBrain(legacyBrainDir());
      for (const f of legacy) {
        if (!files.some((x) => x.key === f.key)) files.push(f);
      }
    }
    return files;
  },

  async parseSession(discovered: DiscoveredSession): Promise<Session | null> {
    // Session id = the brain-dir UUID = basename 3 levels up from the
    // transcript file (.../<uuid>/.system_generated/logs/transcript*.jsonl).
    const uuid = basename(dirname(dirname(dirname(discovered.path))));
    const acc = await parseSessionFile(discovered.path, uuid || "(unknown)");
    if (!acc) return null;
    return toSession(acc);
  },
};