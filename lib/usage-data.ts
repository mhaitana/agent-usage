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
import { codexAdapter } from "./adapters/codex";
import { opencodeAdapter } from "./adapters/opencode";
import { copilotAdapter } from "./adapters/copilot";
import { antigravityAdapter } from "./adapters/antigravity";

// Registered adapters, in the order they appear in the header banner / status.
// Token-bearing adapters first, then the activity-only Antigravity adapter last.
const ADAPTERS: Adapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  copilotAdapter,
  antigravityAdapter,
];

// --- enable/disable via env -----------------------------------------------
//
// Each adapter can be turned off with `<SLUG>_ENABLED=0|false|no|off` (slug
// uppercased: CLAUDE_ENABLED, CODEX_ENABLED, OPENCODE_ENABLED,
// ANTIGRAVITY_ENABLED). Unset → enabled. A disabled adapter drops out
// completely: no hub card, no nav pill, no per-agent route (it 404s), and no
// contribution to the combined totals — distinct from `isAvailable()` (data dir
// missing → muted "Not found" card). The env var name is derived from the
// adapter's slug, mirroring the per-agent `<SLUG>_DIR` data-path override.
//
// Unlike the `_DIR` overrides (which each adapter reads internally because the
// target path differs per tool), the enable flag has a uniform naming
// convention, so it's resolved here in the orchestrator rather than on each
// Adapter — one place, no per-adapter boilerplate.

const DISABLED_TOKENS = new Set(["0", "false", "no", "off"]);

/** Whether an adapter is enabled by env. Unset → enabled; explicit
 *  `0|false|no|off` (case-insensitive) → disabled. */
function isEnabled(adapter: Adapter): boolean {
  const raw = process.env[`${adapter.slug.toUpperCase()}_ENABLED`];
  if (raw === undefined) return true;
  return !DISABLED_TOKENS.has(raw.trim().toLowerCase());
}

/** Adapters that are both registered and env-enabled, in display order. */
function registeredAdapters(): Adapter[] {
  return ADAPTERS.filter(isEnabled);
}

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

  for (const adapter of registeredAdapters()) {
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
    statuses.push({
      name: adapter.name,
      slug: adapter.slug,
      dirLabel: adapter.dirLabel(),
      available,
      hasTokenData: adapter.hasTokenData,
      sessions: count,
    });
  }

  // Deduplicate sessions by sessionId — some adapters (e.g. Copilot) may
  // discover the same logical session from multiple on-disk paths (e.g. VS Code
  // copies a chat session into several workspaceStorage/<hash>/chatSessions/
  // directories). Keep the first occurrence; later duplicates are discarded.
  const seenIds = new Set<string>();
  const dedupedSessions = sessions.filter((s) => {
    if (seenIds.has(s.sessionId)) return false;
    seenIds.add(s.sessionId);
    return true;
  });

  return buildDataset(dedupedSessions, statuses);
}

// --- scoping + per-adapter helpers ----------------------------------------

/** Slugs of all registered + env-enabled adapters — for route validation + nav.
 *  A disabled adapter's slug is absent, so its `/<slug>` route 404s. */
export function knownSlugs(): string[] {
  return registeredAdapters().map((a) => a.slug);
}

/** Adapter display meta (name + slug + dirLabel) without parsing any sessions.
 *  Cheap: used by `generateMetadata` on per-agent pages so they can resolve a
 *  slug → name without running the full dataset fan-out. */
export function adapterMeta(): {
  slug: string;
  name: string;
  dirLabel: string;
  hasTokenData: boolean;
}[] {
  return registeredAdapters().map((a) => ({
    slug: a.slug,
    name: a.name,
    dirLabel: a.dirLabel(),
    hasTokenData: a.hasTokenData,
  }));
}

/** Re-aggregate a dataset to a single adapter by filtering its sessions.
 *  Keeps the full `adapters` status list (so nav + banner still render on
 *  per-agent pages). Cheap: parsing is already done and cached; this is just
 *  an in-memory re-aggregation via `buildDataset`. */
export function scopeDataset(ds: UsageDataset, slug: string): UsageDataset {
  const scoped = ds.sessions.filter((s) => s.adapter === slug);
  return buildDataset(scoped, ds.adapters);
}

/** Per-adapter totals (for the overview hub cards). Computed by grouping
 *  `ds.sessions` by `adapter`; merge with `ds.adapters` for name / dirLabel /
 *  available / session count. Includes messages + toolCalls so token-less
 *  adapters (Antigravity) can show activity stats instead of zero tokens. */
export function perAdapterTotals(
  ds: UsageDataset,
): {
  slug: string;
  totalTokens: number;
  cost: number;
  messages: number;
  toolCalls: number;
}[] {
  const map = new Map<
    string,
    { totalTokens: number; cost: number; messages: number; toolCalls: number }
  >();
  for (const s of ds.sessions) {
    const e = map.get(s.adapter) ?? {
      totalTokens: 0,
      cost: 0,
      messages: 0,
      toolCalls: 0,
    };
    e.totalTokens += s.totalTokens;
    e.cost += s.cost;
    e.messages += s.messageCount;
    e.toolCalls += s.toolCallCount;
    map.set(s.adapter, e);
  }
  return [...map.entries()].map(([slug, v]) => ({ slug, ...v }));
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