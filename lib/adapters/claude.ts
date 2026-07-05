// Claude Code adapter.
//
// Owns everything Claude-specific:
//   - where Claude Code stores sessions (~/.claude/projects/*/*.jsonl,
//     overridable via CLAUDE_DIR),
//   - the JSONL record format (type === "assistant" | "user" | "ai-title"),
//   - humanizing Claude's session-dir slugs into project names,
//   - Anthropic API-price-equivalent cost (lib/pricing.ts).
//
// The orchestrator (lib/usage-data.ts) handles the mtime cache + aggregation,
// so this file is pure extraction.

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { costOf } from "@/lib/pricing/anthropic";
import { tilde } from "@/lib/format";
import type { AssistantUsage, Session } from "@/lib/types";
import type { Adapter, DiscoveredSession } from "./types";

// --- paths ----------------------------------------------------------------

/** Root Claude Code config directory, e.g. /Users/you/.claude. */
function claudeDir(): string {
  // Allow override via env for testing / alternate installs.
  return process.env.CLAUDE_DIR || join(homedir(), ".claude");
}

function projectsDir(): string {
  return join(claudeDir(), "projects");
}

// --- slug humanizing ------------------------------------------------------

function humanizeProjectSlug(slug: string): string {
  // Claude Code session-dir slugs look like -Users-you-Projects-perkr.
  const markers = ["-Projects-", "-project-", "-projects-"];
  for (const m of markers) {
    const idx = slug.indexOf(m);
    if (idx >= 0) {
      const tail = slug.slice(idx + m.length);
      return tail.replace(/-/g, "/").replace(/^\/+|\/+$/g, "") || slug;
    }
  }
  return slug.replace(/^-+/, "");
}

// --- loose shapes for the raw JSONL records ------------------------------

interface ContentBlock {
  type?: string;
  [key: string]: unknown;
}

interface ClaudeMessage {
  model?: string;
  usage?: AssistantUsage;
  content?: ContentBlock[] | unknown;
}

interface ClaudeRecord {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  aiTitle?: string;
  message?: ClaudeMessage;
}

// --- per-session accumulator ---------------------------------------------

interface AccModel {
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface AccSession {
  sessionId: string;
  projectSlug: string;
  cwd: string | null;
  title: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  models: Map<string, AccModel>;
  modelOrder: string[];
  messageCount: number;
  toolCallCount: number;
}

function emptyAccModel(model: string): AccModel {
  return {
    model,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    messageCount: 0,
    toolCallCount: 0,
  };
}

function initAcc(
  sessionId: string | undefined,
  projectSlug: string,
  cwd: string | undefined,
): AccSession {
  return {
    sessionId: sessionId || "(unknown)",
    projectSlug,
    cwd: cwd ?? null,
    title: null,
    firstSeen: null,
    lastSeen: null,
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

// --- parsing --------------------------------------------------------------

/** Parse a single session JSONL file into an accumulator (or null if empty). */
async function parseSessionFile(
  filePath: string,
  projectSlug: string,
): Promise<AccSession | null> {
  let acc: AccSession | null = null;
  const seenModels = new Set<string>();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: ClaudeRecord;
    try {
      rec = JSON.parse(trimmed) as ClaudeRecord;
    } catch {
      continue; // defensive: skip malformed lines
    }
    if (!rec || typeof rec !== "object") continue;

    const type = rec.type;
    const ts: string | undefined = rec.timestamp;

    if (type === "ai-title" && typeof rec.aiTitle === "string") {
      if (!acc) acc = initAcc(rec.sessionId, projectSlug, rec.cwd);
      if (!acc.title) acc.title = rec.aiTitle;
      continue;
    }

    if (type !== "assistant" && type !== "user") continue;

    if (!acc) acc = initAcc(rec.sessionId, projectSlug, rec.cwd);
    bumpTimestamp(acc, ts);
    if (rec.cwd && !acc.cwd) acc.cwd = rec.cwd;

    if (type === "assistant") {
      const msg = rec.message;
      if (!msg) continue;
      const model: string | undefined = msg.model;
      const usage: AssistantUsage | undefined = msg.usage;

      if (model) {
        let m = acc.models.get(model);
        if (!m) {
          m = emptyAccModel(model);
          acc.models.set(model, m);
          if (!seenModels.has(model)) {
            seenModels.add(model);
            acc.modelOrder.push(model);
          }
        }
        if (usage) {
          m.inputTokens += num(usage.input_tokens);
          m.cacheCreationTokens += num(usage.cache_creation_input_tokens);
          m.cacheReadTokens += num(usage.cache_read_input_tokens);
          m.outputTokens += num(usage.output_tokens);
        }
        m.messageCount += 1;
        // Count tool_use content blocks.
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && block.type === "tool_use") {
              m.toolCallCount += 1;
            }
          }
        }
      }
    } else if (type === "user") {
      // User message: count toward session message total only.
      acc.messageCount += 1;
    }
  }

  return acc;
}

/** Map a per-session accumulator into the normalized Session shape. */
function toSession(acc: AccSession): Session {
  const byModel = acc.modelOrder.map((modelId) => {
    const m = acc.models.get(modelId)!;
    const totalTokens =
      m.inputTokens + m.cacheCreationTokens + m.cacheReadTokens + m.outputTokens;
    return {
      model: modelId,
      inputTokens: m.inputTokens,
      cacheCreationTokens: m.cacheCreationTokens,
      cacheReadTokens: m.cacheReadTokens,
      outputTokens: m.outputTokens,
      totalTokens,
      cost: costOf({
        model: modelId,
        inputTokens: m.inputTokens,
        cacheCreationTokens: m.cacheCreationTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
      }),
      messageCount: m.messageCount,
      toolCallCount: m.toolCallCount,
    };
  });

  const inputTokens = sum(byModel, "inputTokens");
  const cacheCreationTokens = sum(byModel, "cacheCreationTokens");
  const cacheReadTokens = sum(byModel, "cacheReadTokens");
  const outputTokens = sum(byModel, "outputTokens");
  const totalTokens =
    inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;
  const cost = sum(byModel, "cost");
  const toolCallCount = sum(byModel, "toolCallCount");

  return {
    sessionId: acc.sessionId,
    adapter: "claude",
    project: humanizeProjectSlug(acc.projectSlug),
    cwd: acc.cwd,
    title: acc.title,
    models: acc.modelOrder.slice(),
    firstSeen: acc.firstSeen,
    lastSeen: acc.lastSeen,
    durationMs: durationMs(acc.firstSeen, acc.lastSeen),
    messageCount: acc.messageCount + sum(byModel, "messageCount"),
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

// --- adapter ---------------------------------------------------------------

export const claudeAdapter: Adapter = {
  name: "Claude Code",
  slug: "claude",

  dirLabel(): string {
    return tilde(projectsDir());
  },

  async isAvailable(): Promise<boolean> {
    try {
      await stat(projectsDir());
      return true;
    } catch {
      return false;
    }
  },

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const dir = projectsDir();
    const out: DiscoveredSession[] = [];
    let projectDirs: string[] = [];
    try {
      projectDirs = await readdir(dir, { withFileTypes: true }).then((entries) =>
        entries.filter((e) => e.isDirectory()).map((e) => e.name),
      );
    } catch {
      return out;
    }
    for (const slug of projectDirs) {
      const projectPath = join(dir, slug);
      let files: string[] = [];
      try {
        files = await readdir(projectPath);
      } catch {
        continue;
      }
      for (const fileName of files) {
        if (!fileName.endsWith(".jsonl")) continue;
        const filePath = join(projectPath, fileName);
        out.push({ key: filePath, path: filePath, projectSlug: slug });
      }
    }
    return out;
  },

  async parseSession(discovered: DiscoveredSession): Promise<Session | null> {
    const acc = await parseSessionFile(discovered.path, discovered.projectSlug);
    if (!acc) return null;
    return toSession(acc);
  },
};