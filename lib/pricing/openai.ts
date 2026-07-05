// API-price-equivalent cost estimation for OpenAI / Codex models.
//
// IMPORTANT: Codex subscriptions (Pro / Plus) are NOT pay-per-token. These
// numbers are the *list API price equivalent* of the tokens consumed — a rough
// gauge of value/volume, not your actual bill. Rates are USD per 1M tokens,
// from OpenAI's public API pricing. Update them when prices change.
//
// OpenAI exposes cache *reads* (cached_input_tokens) but no separate
// cache-creation charge, so the rate shape is { input, cached, output } —
// there is no cacheWrite field (the Codex adapter maps cacheCreationTokens to
// 0).

interface OpenAIModelRate {
  input: number; // per 1M, non-cached
  cached: number; // per 1M, cached input (cache read)
  output: number; // per 1M (includes reasoning tokens)
}

// Fallback rate used for any unknown model id (gpt-5 tier).
const DEFAULT_RATE: OpenAIModelRate = {
  input: 1.25,
  cached: 0.125,
  output: 10,
};

const RATES: Record<string, OpenAIModelRate> = {
  "gpt-5": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
  "gpt-5-pro": { input: 15, cached: 0, output: 120 },
};

/** Pick a rate for a model id, matching known prefixes so dated / point
 *  variants (e.g. gpt-5.4, gpt-5.5) resolve to their base family. */
export function rateFor(model: string): OpenAIModelRate {
  if (RATES[model]) return RATES[model];
  // Try matching by prefix to catch variants like gpt-5.5, gpt-5-mini-2025...
  for (const key of Object.keys(RATES)) {
    if (model.startsWith(key)) return RATES[key];
  }
  // Family heuristics.
  if (model.includes("nano")) return RATES["gpt-5-nano"];
  if (model.includes("mini")) return RATES["gpt-5-mini"];
  if (model.includes("pro")) return RATES["gpt-5-pro"];
  return DEFAULT_RATE;
}

/** Compute USD cost for a token breakdown. Codex never produces
 *  cache-creation tokens, so there is no cacheCreationTokens param. */
export function costOf(args: {
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}): number {
  const r = rateFor(args.model);
  const cost =
    (args.inputTokens / 1e6) * r.input +
    (args.cacheReadTokens / 1e6) * r.cached +
    (args.outputTokens / 1e6) * r.output;
  return cost;
}