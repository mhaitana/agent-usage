// API-price-equivalent cost estimation for GitHub Copilot Chat sessions.
//
// IMPORTANT: Copilot is a subscription product (Pro / Business / Enterprise),
// NOT pay-per-token. These numbers are the *list API price equivalent* of the
// tokens consumed — a rough gauge of value/volume, not your actual bill. The
// `multiplierNumeric` Copilot records (e.g. "3x" for Opus) is a subscription
// quota multiplier (premium requests count N× against your allotment), NOT an
// API price — we deliberately ignore it for cost, consistent with the dashboard's
// "cost = API-price-equivalent, not a subscription bill" convention.
//
// Copilot is multi-vendor: a single chat can route to Anthropic (claude-*),
// OpenAI (gpt-*, o*), or Google (gemini-*). Model ids recorded in Copilot
// sessions are prefixed `copilot/` (e.g. `copilot/claude-opus-4.6`); the
// adapter strips that prefix before calling `rateFor`. After stripping, ids
// look like `claude-opus-4.6`, `gpt-5.3-codex`, `gemini-2.5-pro`.
//
// Resolution order in `rateFor`:
//   1. `claude-*`  → delegate to `anthropic.rateFor` (carries cache-creation
//                     pricing; single source of truth shared with the Claude
//                     adapter — no drift).
//   2. `gpt-5*` / `o*` → delegate to `openai.rateFor` (gpt-5 family + o-series;
//                     shared with the Codex adapter).
//   3. exact → prefix match against the `RATES` table below (covers OpenAI's
//      gpt-4.1 / gpt-4o families not present in openai.ts, plus Google Gemini).
//   4. family heuristics (gemini / gpt-4.1 / gpt-4o) so dated or point variants
//      resolve.
//   5. fallback → { 0, 0, 0, 0 } → honest $0 for models with no public price
//      table (e.g. an untracked Copilot-fronted model). Never fabricate a price.
//
// Rates are USD per 1M tokens, sourced from each vendor's public API pricing
// page. Non-Anthropic providers don't charge a separate cache-creation write
// fee, so `cacheWrite` is 0 for every rate defined here; only the delegated
// Anthropic rates carry a non-zero `cacheWrite` (and that delegation preserves
// it). Copilot records no cache tokens on disk (cacheCreation/cacheRead are
// always 0 from the adapter), so `cached`/`cacheWrite` only matter for the
// delegated Anthropic path. Update the table when a vendor changes pricing.

import * as anthropic from "./anthropic";
import * as openai from "./openai";

interface CopilotModelRate {
  input: number; // per 1M, non-cached
  cached: number; // per 1M, cached input (cache read)
  cacheWrite: number; // per 1M (cache creation; 0 for providers that don't charge)
  output: number; // per 1M (includes reasoning tokens where applicable)
}

const ZERO_RATE: CopilotModelRate = {
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
};

// Copilot-fronted families not already covered by anthropic.ts / openai.ts.
// `cacheWrite` is 0 throughout — only Anthropic charges for cache creation
// (handled via the anthropic delegation above), and that delegation preserves
// its cacheWrite. OpenAI exposes cache reads at a 75% (gpt-4.1) / 50% (gpt-4o)
// discount and no cache-creation charge. Gemini cached input ≈ 10% of input.
const RATES: Record<string, CopilotModelRate> = {
  // --- OpenAI: gpt-4.1 family (not in openai.ts, which is gpt-5-scoped) ---
  "gpt-4.1": { input: 2.0, cached: 0.5, cacheWrite: 0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, cacheWrite: 0, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached: 0.025, cacheWrite: 0, output: 0.4 },
  // --- OpenAI: gpt-4o family ---
  "gpt-4o": { input: 2.5, cached: 1.25, cacheWrite: 0, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, cacheWrite: 0, output: 0.6 },

  // --- Google Gemini 2.5 (≤200K prompt tier for Pro). Output includes thinking
  // tokens. Cached input ≈ 10% of input. Gemini 3.x has no published list price
  // at time of writing — the heuristic maps "pro" variants onto 2.5 Pro as a
  // conservative stand-in. ---
  "gemini-2.5-pro": { input: 1.25, cached: 0.125, cacheWrite: 0, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, cached: 0.03, cacheWrite: 0, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, cached: 0.01, cacheWrite: 0, output: 0.4 },
};

/** Pick a rate for a Copilot-fronted model id (after the `copilot/` prefix is
 *  stripped). Delegates claude-* to anthropic and gpt-5/o-series to openai
 *  (shared source of truth), then resolves gpt-4.1 / gpt-4o / gemini against
 *  the local RATES table and family heuristics. Returns a zero rate for models
 *  with no public price table (honest $0 rather than a fabrication). */
export function rateFor(model: string): CopilotModelRate {
  const m = model.toLowerCase();

  // 1. Anthropic claude-* — delegate (carries cache-creation pricing).
  if (m.includes("claude")) {
    const r = anthropic.rateFor(model);
    return {
      input: r.input,
      cached: r.cacheRead,
      cacheWrite: r.cacheWrite,
      output: r.output,
    };
  }

  // 2. OpenAI gpt-5 family + o-series — delegate to openai.ts. gpt-4.1 / gpt-4o
  //    are NOT in openai.ts (it's gpt-5-scoped), so they fall through to RATES.
  if (m.startsWith("gpt-5") || /^o[0-9]/.test(m)) {
    const r = openai.rateFor(model);
    return { input: r.input, cached: r.cached, cacheWrite: 0, output: r.output };
  }

  // 3. Exact → prefix match against the local RATES table.
  if (RATES[m]) return RATES[m];
  for (const key of Object.keys(RATES)) {
    if (m.startsWith(key)) return RATES[key];
  }

  // 4. Family heuristics (catches dated / point variants not listed verbatim,
  //    e.g. gemini-3.1-pro, gpt-4.1-mini-2025).
  if (m.includes("gemini")) {
    if (m.includes("flash-lite")) return RATES["gemini-2.5-flash-lite"];
    if (m.includes("flash")) return RATES["gemini-2.5-flash"];
    return RATES["gemini-2.5-pro"]; // "pro" / unknown gemini → 2.5 Pro stand-in
  }
  if (m.includes("gpt-4.1")) {
    if (m.includes("nano")) return RATES["gpt-4.1-nano"];
    if (m.includes("mini")) return RATES["gpt-4.1-mini"];
    return RATES["gpt-4.1"];
  }
  if (m.includes("gpt-4o")) {
    if (m.includes("mini")) return RATES["gpt-4o-mini"];
    return RATES["gpt-4o"];
  }

  // 5. Unknown / untracked Copilot-fronted model — honest $0.
  return ZERO_RATE;
}

/** Compute USD cost for a token breakdown. Copilot records no cache tokens on
 *  disk, so cacheCreationTokens / cacheReadTokens are 0 in practice — the
 *  params exist for shape parity with the other pricing modules. */
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
    (args.cacheReadTokens / 1e6) * r.cached +
    (args.outputTokens / 1e6) * r.output;
  return cost;
}