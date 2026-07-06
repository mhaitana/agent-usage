// GitHub Copilot Chat adapter.
//
// Owns everything Copilot-specific:
//   - where VS Code's built-in Copilot Chat stores sessions:
//     per-workspace  ~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl
//     empty-window   ~/Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions/<sessionId>.jsonl
//     (overridable via COPILOT_DIR, which points at the VS Code "User" dir).
//     Legacy single-blob <sessionId>.json files in the empty-window dir carry no
//     token fields — we skip them and only parse .jsonl.
//   - the chatSessions JSONL line format: each line is {kind, v} (sometimes also
//     {kind, k, v}). `kind` is NOT a reliable discriminator — kind:1 lines have
//     many subtypes (bool, string, list, dict). We discriminate by SHAPE:
//       * request  — v is a non-empty array whose items have `requestId`
//                    (carries `timestamp` ms, `modelId` like "copilot/claude-…",
//                    `message.text` = the user prompt). Other kind:2 arrays are
//                    progressive assistant output chunks (items lack requestId)
//                    and are ignored.
//       * response — v is an object with a `metadata` object (carries
//                    `promptTokens`, `outputTokens`, `toolCallRounds[]`).
//   - deriving project / cwd from workspaceStorage/<hash>/workspace.json
//     (`folder` file:// URI), cached per hash dir;
//   - API-price-equivalent cost (lib/pricing/copilot.ts). Copilot records no
//     cost and no cache tokens on disk, so cacheCreation/cacheRead are always 0.
//
// The orchestrator (lib/usage-data.ts) handles the mtime cache + aggregation, so
// this file is pure extraction. Each session is its own file, so the cache keys
// per-file (same as Claude/Codex) — no shared-path invalidation needed.
//
// Token taxonomy mapping (Copilot → normalized Anthropic-shaped Session):
//   inputTokens         = sum(metadata.promptTokens)
//   outputTokens        = sum(metadata.outputTokens) + sum(thinking.tokens)
//                          (reasoning bundled in, matching Codex/OpenCode;
//                          `thinking.tokens` is reported separately from
//                          `outputTokens` — verified on real sessions — so
//                          adding it does not double-count)
//   cacheCreationTokens = 0   (Copilot exposes no cache-creation field)
//   cacheReadTokens     = 0   (Copilot exposes no cache-read field)
// Per-model attribution: each response's tokens are added to the accumulator for
// `currentModel` — the most recent request's `modelId` (with the `copilot/`
// prefix stripped), falling back to the header's `inputState.selectedModel`
// id. `metadata.resolvedModel` is null in practice, so it is not used.

import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { costOf } from "@/lib/pricing/copilot";
import { tilde } from "@/lib/format";
import type { Session } from "@/lib/types";
import type { Adapter, DiscoveredSession } from "./types";

// --- paths ----------------------------------------------------------------

/** VS Code "User" directory, e.g. ~/Library/Application Support/Code/User. */
function copilotDir(): string {
  // Allow override via env for testing / alternate installs (e.g. Cursor,
  // though none is present on this machine). Points at the VS Code "User" dir.
  return process.env.COPILOT_DIR || join(homedir(), "Library/Application Support/Code/User");
}

function workspaceStorageDir(): string {
  return join(copilotDir(), "workspaceStorage");
}

function emptyWindowDir(): string {
  return join(copilotDir(), "globalStorage", "emptyWindowChatSessions");
}

// --- project naming -------------------------------------------------------

function humanizeProject(cwd: string | null | undefined): string {
  if (!cwd) return "Copilot (empty window)";
  // Copilot records the workspace root as the cwd; the basename is the project.
  return basename(cwd) || "Copilot (empty window)";
}

// --- workspace.json → cwd cache (process-local) ---------------------------
//
// Each workspaceStorage/<hash>/workspace.json maps the hash to a file:// URI of
// the real workspace folder. It never changes shape, so we cache the parsed
// folder per hash dir for the life of the process. Two levels up from a
// chatSessions/<id>.jsonl file is the <hash> dir containing workspace.json.

const cwdCache = new Map<string, string | null>(); // hashDir → cwd or null

async function resolveCwd(filePath: string): Promise<string | null> {
  // chatSessions/<id>.jsonl → parent chatSessions → parent <hash>
  const chatSessionsDir = dirname(filePath);
  const hashDir = dirname(chatSessionsDir);
  if (cwdCache.has(hashDir)) return cwdCache.get(hashDir)!;
  let cwd: string | null = null;
  try {
    const raw = await readFile(join(hashDir, "workspace.json"), "utf8");
    const obj = JSON.parse(raw) as { folder?: unknown };
    if (typeof obj.folder === "string") {
      const uri = obj.folder;
      // Strip file:// (or file:/// ) prefix. Handle both file:// and file:/// .
      if (uri.startsWith("file://")) {
        cwd = decodeURIComponent(uri.slice("file://".length).replace(/^\//, "/"));
      } else {
        cwd = uri;
      }
    }
  } catch {
    cwd = null; // empty-window sessions have no workspace.json → cwd stays null
  }
  cwdCache.set(hashDir, cwd);
  return cwd;
}

// --- loose shapes for the raw JSONL records ------------------------------
//
// Lines are {kind, v} (sometimes {kind, k, v}). `kind` is unreliable, so we
// inspect `v`'s shape. These interfaces are permissive ([key: string]: unknown)
// and only the named fields are read.

interface CopilotRequestItem {
  requestId?: unknown;
  timestamp?: number;
  modelId?: string;
  message?: { text?: string; parts?: unknown[] } & Record<string, unknown>;
  [key: string]: unknown;
}

interface CopilotToolCall {
  name?: unknown;
  [key: string]: unknown;
}

interface CopilotThinking {
  tokens?: number;
  [key: string]: unknown;
}

interface CopilotToolRound {
  toolCalls?: CopilotToolCall[];
  thinking?: CopilotThinking;
  [key: string]: unknown;
}

interface CopilotMetadata {
  promptTokens?: number;
  outputTokens?: number;
  toolCallRounds?: CopilotToolRound[];
  [key: string]: unknown;
}

interface CopilotResponseV {
  metadata?: CopilotMetadata;
  [key: string]: unknown;
}

interface CopilotLine {
  kind?: number;
  v?: unknown;
  [key: string]: unknown;
}

// --- per-session accumulator ---------------------------------------------

interface AccModel {
  model: string;
  inputTokens: number;
  outputTokens: number; // includes bundled thinking tokens
  messageCount: number; // assistant responses attributed to this model
  toolCallCount: number;
}

interface AccSession {
  sessionId: string;
  cwd: string | null; // resolved lazily in toSession; null until then
  title: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  currentModel: string | null; // most recent request's modelId (prefix stripped)
  fallbackModel: string | null; // header inputState.selectedModel.metadata.id
  models: Map<string, AccModel>;
  modelOrder: string[];
  messageCount: number; // user request count (session-level)
}

function emptyAccModel(model: string): AccModel {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    messageCount: 0,
    toolCallCount: 0,
  };
}

function initAcc(sessionId: string | undefined): AccSession {
  return {
    sessionId: sessionId || "(unknown)",
    cwd: null,
    title: null,
    firstSeen: null,
    lastSeen: null,
    currentModel: null,
    fallbackModel: null,
    models: new Map(),
    modelOrder: [],
    messageCount: 0,
  };
}

function bumpTimestamp(acc: AccSession, ts: string | null | undefined) {
  if (!ts) return;
  if (!acc.firstSeen || ts < acc.firstSeen) acc.firstSeen = ts;
  if (!acc.lastSeen || ts > acc.lastSeen) acc.lastSeen = ts;
}

function num(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** ISO timestamp from an epoch-ms number. Null if invalid. */
function isoFromMs(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Strip the `copilot/` (or `copilot.`) prefix Copilot puts on model ids. */
function stripCopilotPrefix(modelId: string | undefined | null): string | null {
  if (typeof modelId !== "string" || !modelId) return null;
  return modelId.replace(/^copilot\//, "");
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

/** Determine the model to attribute a response to: currentModel, else the
 *  header fallback, else a literal "copilot" so we never lose tokens. */
function resolveTurnModel(acc: AccSession): string {
  return acc.currentModel ?? acc.fallbackModel ?? "copilot";
}

// --- parsing --------------------------------------------------------------

/** True if `v` is a request list (non-empty array of items with requestId). */
function isRequestList(v: unknown): v is CopilotRequestItem[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = v[0];
  return (
    !!first && typeof first === "object" && "requestId" in first
  );
}

/** True if `v` is a token-bearing response object (has a metadata object). */
function isResponseObject(v: unknown): v is CopilotResponseV {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "metadata" in v &&
    typeof (v as CopilotResponseV).metadata === "object" &&
    !!(v as CopilotResponseV).metadata
  );
}

/** Extract a session title: prefer header customTitle, else the first user
 *  request's message.text, stripped of <...> tags and sliced to 100 chars. */
function deriveTitle(customTitle: unknown, firstUserText: string | null): string | null {
  if (typeof customTitle === "string" && customTitle.trim()) return customTitle.trim();
  if (!firstUserText) return null;
  const stripped = firstUserText.replace(/<[^>]*>/g, "").trim();
  return stripped ? stripped.slice(0, 100) : null;
}

/** Parse one chatSessions JSONL file into an accumulator (or null if it has
 *  no token-bearing responses). */
async function parseSessionFile(filePath: string): Promise<AccSession | null> {
  const acc = initAcc(undefined);
  let firstUserText: string | null = null;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: CopilotLine;
    try {
      rec = JSON.parse(trimmed) as CopilotLine;
    } catch {
      continue; // defensive: skip malformed lines
    }
    if (!rec || typeof rec !== "object") continue;
    const v = rec.v;

    // Header (kind:0): capture sessionId, creationDate, customTitle, and the
    // selectedModel id as a fallback for model attribution.
    if (rec.kind === 0 && v && typeof v === "object" && !Array.isArray(v)) {
      const header = v as {
        sessionId?: unknown;
        creationDate?: unknown;
        customTitle?: unknown;
        inputState?: { selectedModel?: { metadata?: { id?: unknown } } } & Record<string, unknown>;
      } & Record<string, unknown>;
      if (typeof header.sessionId === "string") acc.sessionId = header.sessionId;
      const created = isoFromMs(header.creationDate);
      if (created) bumpTimestamp(acc, created);
      if (header.customTitle !== undefined) {
        acc.title = deriveTitle(header.customTitle, null);
      }
      const sm = header.inputState?.selectedModel?.metadata?.id;
      if (typeof sm === "string") acc.fallbackModel = stripCopilotPrefix(sm) ?? sm;
      continue;
    }

    // Request list: each item is one user message with a timestamp + modelId.
    if (isRequestList(v)) {
      for (const req of v) {
        acc.messageCount += 1;
        const ts = isoFromMs(req.timestamp);
        if (ts) bumpTimestamp(acc, ts);
        const m = stripCopilotPrefix(req.modelId);
        if (m) acc.currentModel = m;
        const text = req.message?.text;
        if (typeof text === "string" && firstUserText === null) {
          firstUserText = text;
        }
      }
      continue;
    }

    // Token-bearing response: attribute promptTokens + outputTokens + tool
    // calls + one assistant message to the current (or fallback) model.
    if (isResponseObject(v)) {
      const md = v.metadata!;
      const model = resolveTurnModel(acc);
      const m = modelAcc(acc, model);
      m.inputTokens += num(md.promptTokens);
      let thinkingTotal = 0;
      let toolTotal = 0;
      if (Array.isArray(md.toolCallRounds)) {
        for (const round of md.toolCallRounds) {
          if (round && typeof round === "object") {
            thinkingTotal += num(round.thinking?.tokens);
            if (Array.isArray(round.toolCalls)) toolTotal += round.toolCalls.length;
          }
        }
      }
      m.outputTokens += num(md.outputTokens) + thinkingTotal;
      m.toolCallCount += toolTotal;
      m.messageCount += 1; // one assistant response
      // The response itself carries no timestamp in `v`; the preceding request
      // already bumped lastSeen, so no timestamp update here.
      continue;
    }
    // Every other line kind (booleans, strings, progressive output chunks,
    // completed markers, etc.) is ignored for usage purposes.
  }

  if (acc.modelOrder.length === 0) return null; // no token-bearing responses
  // If no header title was set, fall back to the first user prompt text.
  if (acc.title === null) acc.title = deriveTitle(null, firstUserText);
  return acc;
}

/** Map a per-session accumulator into the normalized Session shape. cwd is
 *  resolved from workspace.json for workspace sessions (null for empty-window). */
async function toSession(acc: AccSession, filePath: string): Promise<Session> {
  const cwd = await resolveCwd(filePath);

  const byModel = acc.modelOrder.map((modelId) => {
    const m = acc.models.get(modelId)!;
    const totalTokens = m.inputTokens + m.outputTokens;
    return {
      model: modelId,
      inputTokens: m.inputTokens,
      cacheCreationTokens: 0, // Copilot exposes no cache-creation field
      cacheReadTokens: 0, // Copilot exposes no cache-read field
      outputTokens: m.outputTokens,
      totalTokens,
      cost: costOf({
        model: modelId,
        inputTokens: m.inputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: m.outputTokens,
      }),
      messageCount: m.messageCount,
      toolCallCount: m.toolCallCount,
    };
  });

  const inputTokens = sum(byModel, "inputTokens");
  const outputTokens = sum(byModel, "outputTokens");
  const totalTokens = inputTokens + outputTokens;
  const cost = sum(byModel, "cost");
  const toolCallCount = sum(byModel, "toolCallCount");

  return {
    sessionId: acc.sessionId,
    adapter: "copilot",
    project: humanizeProject(cwd),
    cwd,
    title: acc.title,
    models: acc.modelOrder.slice(),
    firstSeen: acc.firstSeen,
    lastSeen: acc.lastSeen,
    durationMs: durationMs(acc.firstSeen, acc.lastSeen),
    messageCount: acc.messageCount + sum(byModel, "messageCount"),
    toolCallCount,
    inputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
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

/** Collect <hash>/chatSessions/*.jsonl under workspaceStorageDir(). Returns []
 *  if the dir is missing. Non-recursive: only one level of hash dirs, then the
 *  chatSessions subfolder inside each — we deliberately do NOT walk other
 *  subfolders (chatEditingSessions, GitHub.copilot-chat/transcripts, …). */
async function discoverWorkspaceSessions(): Promise<string[]> {
  const out: string[] = [];
  let hashes;
  try {
    hashes = await readdir(workspaceStorageDir(), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const h of hashes) {
    if (!h.isDirectory()) continue;
    const chatDir = join(workspaceStorageDir(), h.name, "chatSessions");
    let files;
    try {
      files = await readdir(chatDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.isFile() && f.name.endsWith(".jsonl")) out.push(join(chatDir, f.name));
    }
  }
  return out;
}

/** Collect *.jsonl (skip legacy .json blobs — no token data) from the
 *  empty-window sessions dir. */
async function discoverEmptyWindowSessions(): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(emptyWindowDir(), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const f of entries) {
    if (f.isFile() && f.name.endsWith(".jsonl")) out.push(join(emptyWindowDir(), f.name));
  }
  return out;
}

// --- adapter --------------------------------------------------------------

export const copilotAdapter: Adapter = {
  name: "GitHub Copilot",
  slug: "copilot",
  hasTokenData: true,

  dirLabel(): string {
    return tilde(workspaceStorageDir());
  },

  async isAvailable(): Promise<boolean> {
    // Available if either session store exists on disk.
    try {
      await stat(workspaceStorageDir());
      return true;
    } catch {
      try {
        await stat(emptyWindowDir());
        return true;
      } catch {
        return false;
      }
    }
  },

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const files = [
      ...(await discoverWorkspaceSessions()),
      ...(await discoverEmptyWindowSessions()),
    ];
    // projectSlug is unused by this adapter — project is derived from cwd at
    // parse time (via workspace.json). The interface field is required, so "".
    return files.map((filePath) => ({ key: filePath, path: filePath, projectSlug: "" }));
  },

  async parseSession(discovered: DiscoveredSession): Promise<Session | null> {
    const acc = await parseSessionFile(discovered.path);
    if (!acc) return null; // no token-bearing responses
    return toSession(acc, discovered.path);
  },
};