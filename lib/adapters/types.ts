// The adapter contract. Each coding agent (Claude Code, Codex, Antigravity, …)
// implements this interface so the orchestrator (lib/usage-data.ts) can discover
// and parse its sessions without knowing anything about the tool's on-disk
// format. Adding a new agent = a new file in lib/adapters/ + registration in
// lib/usage-data.ts. See README "Adding a new agent".

import type { Session } from "@/lib/types";

/** A session file located by an adapter's discovery pass. */
export interface DiscoveredSession {
  /** Stable cache key — typically the absolute file path. */
  key: string;
  /** Locator the adapter parses — typically a file path. */
  path: string;
  /** Pre-humanization project / group identifier. */
  projectSlug: string;
}

/**
 * A coding-agent data source. Adapters are responsible for:
 *   - knowing where their tool stores sessions (and the env override for it),
 *   - the raw record format of those sessions,
 *   - mapping their vendor's token taxonomy onto the normalized `Session`
 *     shape (zeros for fields the tool doesn't expose), and
 *   - computing their vendor's API-price-equivalent cost.
 *
 * The orchestrator owns the mtime cache + all aggregation, so adapters stay
 * focused on extraction.
 */
export interface Adapter {
  readonly name: string;
  /** URL-safe id used for per-agent routes + nav (e.g. "claude", "codex"). */
  readonly slug: string;
  /** Whether this tool's data directory exists on this machine. */
  isAvailable(): Promise<boolean>;
  /** Enumerate this tool's session files. */
  discoverSessions(): Promise<DiscoveredSession[]>;
  /** Parse one discovered session into a normalized Session (null if empty/invalid). */
  parseSession(discovered: DiscoveredSession): Promise<Session | null>;
  /** Display path for the header subtitle (e.g. "~/.claude/projects"), with
   *  any env override applied. */
  dirLabel(): string;
}