// API-price-equivalent cost estimation.
//
// IMPORTANT: Claude Code subscriptions (Pro / Max) are NOT pay-per-token.
// These numbers are the *list API price equivalent* of the tokens consumed — a
// rough gauge of value/volume, not your actual bill. Rates are USD per 1M
// tokens, from Anthropic's public API pricing. Update them when prices change.

interface ModelRate {
  input: number; // per 1M
  output: number; // per 1M
  cacheWrite: number; // per 1M (cache creation)
  cacheRead: number; // per 1M
}

// Fallback rate used for any unknown model id.
const DEFAULT_RATE: ModelRate = {
  input: 3,
  output: 15,
  cacheWrite: 3.75, // input * 1.25
  cacheRead: 0.3, // input * 0.1
};

const RATES: Record<string, ModelRate> = {
  // Claude 5 family
  "claude-fable-5": { input: 1.25, output: 10, cacheWrite: 1.5625, cacheRead: 0.125 },
  "claude-sonnet-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-opus-4-8": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  // Claude 4.x
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-opus-4-1": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  // Haiku
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** Pick a rate for a model id, matching known prefixes so dated variants resolve. */
export function rateFor(model: string): ModelRate {
  if (RATES[model]) return RATES[model];
  // Try matching by prefix to catch dated variants like claude-haiku-4-5-20251001.
  for (const key of Object.keys(RATES)) {
    if (model.startsWith(key)) return RATES[key];
  }
  // Family heuristics.
  if (model.includes("haiku")) return RATES["claude-haiku-4-5"];
  if (model.includes("opus")) return RATES["claude-opus-4-8"];
  if (model.includes("sonnet")) return RATES["claude-sonnet-5"];
  if (model.includes("fable")) return RATES["claude-fable-5"];
  return DEFAULT_RATE;
}

/** Compute USD cost for a token breakdown. */
export function costOf(args: {
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}): number {
  const r = rateFor(args.model);
  const cost =
    (args.inputTokens / 1e6) * r.input +
    (args.cacheCreationTokens / 1e6) * r.cacheWrite +
    (args.cacheReadTokens / 1e6) * r.cacheRead +
    (args.outputTokens / 1e6) * r.output;
  return cost;
}