// Usage-data orchestrator.
//
// Tool-agnostic: owns the adapter registry, a generic in-memory mtime cache,
// and all aggregation into the final UsageDataset. Each Adapter
// (lib/adapters/*) handles its own discovery + parsing + vendor pricing; this
// file just fans out across registered adapters and aggregates the normalized
// Session[] they return.
//
// To add a new agent: implement Adapter in lib/adapters/<tool>.ts and add it
// to ADAPTERS below. See README "Adding a new agent".

import { stat } from "node:fs/promises";
import type {
  AdapterStatus,
  DailyPoint,
  ModelTotal,
  ProjectTotal,
  Session,
  UsageDataset,
} from "./types";
import type { Adapter, DiscoveredSession } from "./adapters/types";
import { claudeAdapter } from "./adapters/claude";

// Registered adapters, in the order they appear in the header banner / status.
const ADAPTERS: Adapter[] = [claudeAdapter];

// --- in-memory mtime cache ------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  size: number;
  session: Session | null;
}

const fileCache = new Map<string, CacheEntry>();

/** stat → cache check → adapter.parseSession on miss. Process-local cache. */
async function parseWithCache(
  adapter: Adapter,
  discovered: DiscoveredSession,
): Promise<Session | null> {
  let st;
  try {
    st = await stat(discovered.path);
  } catch {
    return null;
  }
  const cached = fileCache.get(discovered.key);
  if (
    cached &&
    cached.mtimeMs === st.mtimeMs &&
    cached.size === st.size &&
    cached.session
  ) {
    return cached.session;
  }
  const session = await adapter.parseSession(discovered);
  fileCache.set(discovered.key, {
    mtimeMs: st.mtimeMs,
    size: st.size,
    session,
  });
  return session;
}

// --- main entry -----------------------------------------------------------

export async function getUsageDataset(): Promise<UsageDataset> {
  const sessions: Session[] = [];
  const statuses: AdapterStatus[] = [];

  for (const adapter of ADAPTERS) {
    const available = await adapter.isAvailable();
    let count = 0;
    if (available) {
      const discovered = await adapter.discoverSessions();
      for (const d of discovered) {
        const s = await parseWithCache(adapter, d);
        if (s) {
          sessions.push(s);
          count++;
        }
      }
    }
    statuses.push({ name: adapter.name, available, sessions: count });
  }

  return buildDataset(sessions, statuses);
}

// --- aggregate views ------------------------------------------------------

function buildDataset(
  sessions: Session[],
  adapters: AdapterStatus[],
): UsageDataset {
  // Sort sessions by lastSeen desc (most recent first).
  sessions.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));

  const dailyMap = new Map<string, DailyPoint>();
  const dailyModelMap = new Map<string, Map<string, number>>();
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

    // Daily attribution by lastSeen day — each session lands on a single day
    // (the day of its lastSeen), matching the sessionCount-per-day intent.
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
    adapters,
  };
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sum<T>(arr: T[], key: keyof T): number {
  let total = 0;
  for (const item of arr) total += Number(item[key]) || 0;
  return total;
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