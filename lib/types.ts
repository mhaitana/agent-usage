// Shared types for the Claude Code usage dashboard.

/** Per-model token totals for a single session. */
export interface ModelTokens {
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** Convenience: input + cacheCreation + cacheRead + output. */
  totalTokens: number;
  /** API-price-equivalent cost in USD (see lib/pricing.ts). */
  cost: number;
  messageCount: number;
  toolCallCount: number;
}

/** One row in the sessions table. */
export interface Session {
  sessionId: string;
  /** Humanized project name, derived from the parent directory slug. */
  project: string;
  /** Raw cwd recorded in the session, if any. */
  cwd: string | null;
  title: string | null;
  /** Models used, in encounter order. */
  models: string[];
  /** ISO timestamp of the first assistant/user record. */
  firstSeen: string | null;
  /** ISO timestamp of the last assistant/user record. */
  lastSeen: string | null;
  /** Wall-clock duration in ms (lastSeen - firstSeen). */
  durationMs: number;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  /** Per-model breakdown for this session. */
  byModel: ModelTokens[];
}

export interface DailyPoint {
  /** YYYY-MM-DD (local). */
  date: string;
  totalTokens: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cost: number;
  sessions: number;
  /** Map of model → total tokens that day (sorted encounter order). */
  byModel: { model: string; tokens: number }[];
}

export interface ModelTotal {
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  sessions: number;
}

export interface ProjectTotal {
  project: string;
  totalTokens: number;
  cost: number;
  sessions: number;
}

export interface Totals {
  sessions: number;
  messages: number;
  toolCalls: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  /** Earliest firstSeen across sessions. */
  firstSeen: string | null;
  /** Latest lastSeen across sessions. */
  lastSeen: string | null;
}

export interface UsageDataset {
  generatedAt: string;
  sessions: Session[];
  daily: DailyPoint[];
  byModel: ModelTotal[];
  byProject: ProjectTotal[];
  totals: Totals;
  /** Whether the ~/.claude directory was found. */
  foundClaudeDir: boolean;
}

/** Subset of the assistant `message.usage` block we read. */
export interface AssistantUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}