import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { projectsDir } from "./paths";
import { costOf } from "./pricing";
import { humanizeProjectSlug } from "./format";
import type {
  AssistantUsage,
  DailyPoint,
  ModelTotal,
  ProjectTotal,
  Session,
  UsageDataset,
} from "./types";

// --- loose shapes for the raw JSONL records -------------------------------

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

// --- per-session accumulator -------------------------------------------------

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

function bumpTimestamp(acc: AccSession, ts: string | null | undefined) {
  if (!ts) return;
  if (!acc.firstSeen || ts < acc.firstSeen) acc.firstSeen = ts;
  if (!acc.lastSeen || ts > acc.lastSeen) acc.lastSeen = ts;
}

interface ParsedFile {
  /** ISO timestamp of the newest record seen — used to invalidate cache. */
  maxTs: string | null;
  /** Accumulator. Null if the file produced no usable records. */
  acc: AccSession | null;
}

/** Parse a single session JSONL file into an accumulator. */
async function parseSessionFile(
  filePath: string,
  projectSlug: string,
): Promise<ParsedFile> {
  let acc: AccSession | null = null;
  let maxTs: string | null = null;
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
    if (ts && (maxTs === null || ts > maxTs)) maxTs = ts;

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

  return { maxTs, acc };
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

function num(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

// --- in-memory mtime cache ---------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedFile;
}

const fileCache = new Map<string, CacheEntry>();

async function parseWithCache(
  filePath: string,
  projectSlug: string,
): Promise<ParsedFile | null> {
  let st;
  try {
    st = await stat(filePath);
  } catch {
    return null;
  }
  const cached = fileCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === st.mtimeMs &&
    cached.size === st.size &&
    cached.parsed.acc
  ) {
    return cached.parsed;
  }
  const parsed = await parseSessionFile(filePath, projectSlug);
  fileCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, parsed });
  return parsed;
}

// --- main entry -------------------------------------------------------------

export async function getUsageDataset(): Promise<UsageDataset> {
  const dir = projectsDir();
  let projectDirs: string[] = [];
  try {
    projectDirs = await readdir(dir, { withFileTypes: true })
      .then((entries) =>
        entries.filter((e) => e.isDirectory()).map((e) => e.name),
      );
  } catch {
    return emptyDataset(false);
  }

  const sessions: Session[] = [];

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
      const parsed = await parseWithCache(filePath, slug);
      if (!parsed?.acc) continue;
      sessions.push(toSession(parsed.acc));
    }
  }

  return buildDataset(sessions, true);
}

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
  const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;
  const cost = sum(byModel, "cost");
  const toolCallCount = sum(byModel, "toolCallCount");

  return {
    sessionId: acc.sessionId,
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

function durationMs(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, b - a);
}

function sum<T>(arr: T[], key: keyof T): number {
  let total = 0;
  for (const item of arr) total += Number(item[key]) || 0;
  return total;
}

// --- aggregate views --------------------------------------------------------

function buildDataset(sessions: Session[], found: boolean): UsageDataset {
  // Sort sessions by lastSeen desc (most recent first).
  sessions.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));

  // Daily aggregation keyed by YYYY-MM-DD (local).
  const dailyMap = new Map<string, DailyPoint>();
  const dailyModelMap = new Map<string, Map<string, number>>();
  const modelOrder = new Set<string>();
  const projectMap = new Map<string, ProjectTotal>();
  const modelTotalsMap = new Map<string, ModelTotal & { _sessions: Set<string> }>();

  for (const s of sessions) {
    // Project totals.
    const pt = projectMap.get(s.project) || {
      project: s.project,
      totalTokens: 0,
      cost: 0,
      sessions: 0,
    };
    pt.totalTokens += s.totalTokens;
    pt.cost += s.cost;
    pt.sessions += 1;
    projectMap.set(s.project, pt);

    // Per-model totals + session attribution.
    for (const m of s.byModel) {
      modelOrder.add(m.model);
      let mt = modelTotalsMap.get(m.model);
      if (!mt) {
        mt = {
          model: m.model,
          inputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          sessions: 0,
          _sessions: new Set<string>(),
        };
      }
      mt.inputTokens += m.inputTokens;
      mt.cacheCreationTokens += m.cacheCreationTokens;
      mt.cacheReadTokens += m.cacheReadTokens;
      mt.outputTokens += m.outputTokens;
      mt.totalTokens += m.totalTokens;
      mt.cost += m.cost;
      mt._sessions.add(s.sessionId);
      modelTotalsMap.set(m.model, mt);
    }

    // Daily attribution by firstSeen? Better: attribute by lastSeen day for a
    // session-level "active that day" view. We bucket each session's tokens onto
    // the day of its lastSeen. This keeps a session on a single day for the
    // chart, which matches stats-cache.json's sessionCount-per-day intent.
    const day = dayKey(s.lastSeen ?? s.firstSeen);
    if (day) {
      let dp = dailyMap.get(day);
      if (!dp) {
        dp = {
          date: day,
          totalTokens: 0,
          inputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          cost: 0,
          sessions: 0,
          byModel: [],
        };
        dailyMap.set(day, dp);
        dailyModelMap.set(day, new Map());
      }
      dp.totalTokens += s.totalTokens;
      dp.inputTokens += s.inputTokens;
      dp.cacheCreationTokens += s.cacheCreationTokens;
      dp.cacheReadTokens += s.cacheReadTokens;
      dp.outputTokens += s.outputTokens;
      dp.cost += s.cost;
      dp.sessions += 1;
      const dm = dailyModelMap.get(day)!;
      for (const m of s.byModel) {
        dm.set(m.model, (dm.get(m.model) || 0) + m.totalTokens);
      }
    }
  }

  const daily = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dp]) => {
      const dm = dailyModelMap.get(date)!;
      const byModel = [...dm.entries()]
        .map(([model, tokens]) => ({ model, tokens }))
        .sort((a, b) => b.tokens - a.tokens);
      return { ...dp, byModel };
    });

  const byModel: ModelTotal[] = [...modelTotalsMap.values()]
    .map(({ _sessions, ...rest }) => ({ ...rest, sessions: _sessions.size }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const byProject: ProjectTotal[] = [...projectMap.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens,
  );

  const totals = {
    sessions: sessions.length,
    messages: sum(sessions, "messageCount"),
    toolCalls: sum(sessions, "toolCallCount"),
    inputTokens: sum(sessions, "inputTokens"),
    cacheCreationTokens: sum(sessions, "cacheCreationTokens"),
    cacheReadTokens: sum(sessions, "cacheReadTokens"),
    outputTokens: sum(sessions, "outputTokens"),
    totalTokens: sum(sessions, "totalTokens"),
    cost: sum(sessions, "cost"),
    firstSeen: sessions.reduce<string | null>(
      (min, s) => earliest(min, s.firstSeen),
      null,
    ),
    lastSeen: sessions.reduce<string | null>(
      (max, s) => latest(max, s.lastSeen),
      null,
    ),
  };

  return {
    generatedAt: new Date().toISOString(),
    sessions,
    daily,
    byModel,
    byProject,
    totals,
    foundClaudeDir: found,
  };
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Local date components.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function emptyDataset(found: boolean): UsageDataset {
  return {
    generatedAt: new Date().toISOString(),
    sessions: [],
    daily: [],
    byModel: [],
    byProject: [],
    totals: {
      sessions: 0,
      messages: 0,
      toolCalls: 0,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      firstSeen: null,
      lastSeen: null,
    },
    foundClaudeDir: found,
  };
}