// API-price-equivalent cost estimation for OpenCode sessions.
//
// OpenCode is provider-agnostic: a single install can route to Anthropic,
// OpenAI, Google, GitHub Copilot, Zhipu (GLM), Moonshot (Kimi), DeepSeek,
// Alibaba (Qwen), Mistral, or a local/OLLAMA gateway — any provider its config
// points at. The `session.cost` column is therefore only populated when OpenCode
// itself has a price table for the routed model, and it is `0` whenever the
// model is served through a proxy with no pricing (e.g. an OLLAMA gateway
// fronting glm-5.2 or kimi-k2.7-code, as on this machine). When `cost` is 0, the
// OpenCode adapter calls `costOf` here to recompute an API-price-equivalent
// estimate from the recorded tokens.
//
// Resolution order in `rateFor`:
//   1. `claude-*`           → delegate to `anthropic.rateFor` (carries
//                              cache-creation pricing; single source of truth
//                              shared with the Claude adapter — no drift).
//   2. `gpt-5*` / `o*`      → delegate to `openai.rateFor` (gpt-5 family + the
//                              o-series default; shared with the Codex adapter).
//   3. exact → prefix match against the `RATES` table below (covers OpenAI's
//      gpt-4.1 / gpt-4o families not present in openai.ts, plus Google, Zhipu,
//      Moonshot, DeepSeek, Qwen, and Mistral).
//   4. family / provider heuristics (gemini / kimi / glm / deepseek / qwen /
//      mistral / gpt-4.1 / gpt-4o) so dated or point variants resolve.
//   5. fallback             → { 0, 0, 0, 0 } → honest $0 for models with no
//                              public price table (e.g. self-hosted OLLAMA
//                              open-weights, or a proxy model we don't track).
//
// Rates are USD per 1M tokens, sourced from each vendor's public API pricing
// page (verified July 2026). Non-Anthropic providers don't charge a separate
// cache-creation write fee — caching is automatic/best-effort or billed as
// storage (Gemini) — so `cacheWrite` is 0 for every rate defined here; only the
// delegated Anthropic rates carry a non-zero `cacheWrite`. Update the table when
// a vendor changes pricing; add a new entry (and a heuristic branch if the id
// family is new) when you want accurate costs for another model.

import * as anthropic from "./anthropic";
import * as openai from "./openai";

interface OpenCodeModelRate {
  input: number; // per 1M, non-cached
  cached: number; // per 1M, cached input (cache read)
  cacheWrite: number; // per 1M (cache creation; 0 for providers that don't charge)
  output: number; // per 1M (includes reasoning tokens where applicable)
}

const ZERO_RATE: OpenCodeModelRate = {
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
};

// Multi-vendor rate table. Keys are lowercased model id prefixes. `cacheWrite`
// is 0 throughout — only Anthropic charges for cache creation (handled via the
// anthropic delegation above), and that delegation preserves its cacheWrite.
//
// OpenAI gpt-4.1 / gpt-4o families are listed here (not in openai.ts, which is
// scoped to the gpt-5 family Codex uses). OpenAI exposes cache reads at a 75%
// (gpt-4.1) / 50% (gpt-4o) discount and no cache-creation charge.
const RATES: Record<string, OpenCodeModelRate> = {
  // --- OpenAI: gpt-4.1 family (Apr 2025) ---
  "gpt-4.1": { input: 2.0, cached: 0.5, cacheWrite: 0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, cacheWrite: 0, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached: 0.025, cacheWrite: 0, output: 0.4 },
  // --- OpenAI: gpt-4o family ---
  "gpt-4o": { input: 2.5, cached: 1.25, cacheWrite: 0, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, cacheWrite: 0, output: 0.6 },

  // --- Google Gemini 2.5 (≤200K prompt tier for Pro) ---
  // Output includes thinking tokens. Cached input ≈ 10% of input. Gemini 3.x
  // has no published list price at time of writing — the heuristic maps "pro"
  // variants onto the 2.5 Pro rate as a conservative stand-in.
  "gemini-2.5-pro": { input: 1.25, cached: 0.125, cacheWrite: 0, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, cached: 0.03, cacheWrite: 0, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, cached: 0.01, cacheWrite: 0, output: 0.4 },

  // --- Zhipu (Z.AI) GLM ---
  // GLM-4.5 / 4.6: $0.60 / $2.20, cached $0.11. GLM-5.2 flagship (Jun 2026):
  // $1.40 / $4.40; cache-read not published — estimated at ~18% of input
  // (matching GLM-4.6's cache discount). GLM-4.x Flash tiers are free.
  "glm-5.2": { input: 1.4, cached: 0.25, cacheWrite: 0, output: 4.4 },
  "glm-4.6": { input: 0.6, cached: 0.11, cacheWrite: 0, output: 2.2 },
  "glm-4.5": { input: 0.6, cached: 0.11, cacheWrite: 0, output: 2.2 },
  "glm-flash": { input: 0, cached: 0, cacheWrite: 0, output: 0 },

  // --- Moonshot Kimi K2 family ---
  // K2.7 Code (on this machine): $0.95 / $0.19 cache / $4.00. K2.6 flagship and
  // K2.5 cheaper tier included. Automatic context caching (~80% input discount).
  "kimi-k2.7-code": { input: 0.95, cached: 0.19, cacheWrite: 0, output: 4.0 },
  "kimi-k2.6": { input: 0.95, cached: 0.16, cacheWrite: 0, output: 4.0 },
  "kimi-k2.5": { input: 0.6, cached: 0.1, cacheWrite: 0, output: 3.0 },

  // --- DeepSeek ---
  // V3 chat: $0.14 / $0.28 (cache 10%). V3.1 / V3.2 priced higher. R1 reasoner:
  // $0.55 / $2.19 (cache 75% off → $0.14); reasoning tokens billed as output.
  // V4 pro / flash from 2026 pricing. Cache is automatic, no write charge.
  "deepseek-r1": { input: 0.55, cached: 0.14, cacheWrite: 0, output: 2.19 },
  "deepseek-reasoner": { input: 0.55, cached: 0.14, cacheWrite: 0, output: 2.19 },
  "deepseek-v4-pro": { input: 0.435, cached: 0.0435, cacheWrite: 0, output: 0.87 },
  "deepseek-v4-flash": { input: 0.14, cached: 0.014, cacheWrite: 0, output: 0.28 },
  "deepseek-v3.2": { input: 0.28, cached: 0.028, cacheWrite: 0, output: 0.42 },
  "deepseek-v3.1": { input: 0.27, cached: 0.027, cacheWrite: 0, output: 1.1 },
  "deepseek-v3": { input: 0.14, cached: 0.014, cacheWrite: 0, output: 0.28 },
  "deepseek-chat": { input: 0.14, cached: 0.014, cacheWrite: 0, output: 0.28 },

  // --- Alibaba Qwen (DashScope) ---
  // USD approximations of the international (Singapore/Virginia) rate card —
  // China-mainland RMB pricing is substantially cheaper; we use the
  // international USD as a conservative default. Cache ≈ 25% of input.
  "qwen3-max": { input: 2.77, cached: 0.69, cacheWrite: 0, output: 8.31 },
  "qwen-max": { input: 2.77, cached: 0.69, cacheWrite: 0, output: 8.31 },
  "qwen3-plus": { input: 0.3, cached: 0.075, cacheWrite: 0, output: 1.18 },
  "qwen-plus": { input: 0.3, cached: 0.075, cacheWrite: 0, output: 1.18 },
  "qwen3-flash": { input: 0.18, cached: 0.045, cacheWrite: 0, output: 1.06 },
  "qwen-flash": { input: 0.18, cached: 0.045, cacheWrite: 0, output: 1.06 },
  "qwen-turbo": { input: 0.044, cached: 0.011, cacheWrite: 0, output: 0.089 },

  // --- Mistral ---
  // Large 3 flagship: $0.50 / $1.50. Codestral (code-specialized): $0.30 / $0.90.
  // Small: $0.20 / $0.60. No published cache-read SKU — estimated at 10% input.
  "mistral-large": { input: 0.5, cached: 0.05, cacheWrite: 0, output: 1.5 },
  "codestral": { input: 0.3, cached: 0.03, cacheWrite: 0, output: 0.9 },
  "mistral-small": { input: 0.2, cached: 0.02, cacheWrite: 0, output: 0.6 },
};

/** Pick a rate for an OpenCode model id. Delegates claude-* to anthropic and
 *  gpt-5/o-series to openai (shared source of truth), then resolves against the
 *  multi-vendor RATES table and family heuristics. Returns a zero rate for
 *  models with no public price table (honest $0 rather than a fabrication). */
export function rateFor(model: string): OpenCodeModelRate {
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
  //    are NOT in openai.ts (it's scoped to the gpt-5 family Codex uses), so
  //    they fall through to the RATES table below.
  if (m.startsWith("gpt-5") || /^o[0-9]/.test(m)) {
    const r = openai.rateFor(model);
    return { input: r.input, cached: r.cached, cacheWrite: 0, output: r.output };
  }

  // 3. Exact → prefix match against the multi-vendor RATES table.
  if (RATES[m]) return RATES[m];
  for (const key of Object.keys(RATES)) {
    if (m.startsWith(key)) return RATES[key];
  }

  // 4. Family / provider heuristics (catches dated / point variants and ids
  //    not listed verbatim, e.g. gemini-3.1-pro, glm-4.7, kimi-k2.6-thinking).
  if (m.includes("gemini")) {
    if (m.includes("flash-lite")) return RATES["gemini-2.5-flash-lite"];
    if (m.includes("flash")) return RATES["gemini-2.5-flash"];
    return RATES["gemini-2.5-pro"]; // "pro" / unknown gemini → 2.5 Pro stand-in
  }
  if (m.includes("kimi")) {
    if (m.includes("k2.5")) return RATES["kimi-k2.5"];
    if (m.includes("k2.7")) return RATES["kimi-k2.7-code"];
    if (m.includes("k2.6")) return RATES["kimi-k2.6"];
    return RATES["kimi-k2.6"]; // default Kimi flagship
  }
  if (m.includes("glm")) {
    if (m.includes("flash")) return RATES["glm-flash"];
    return RATES["glm-4.6"]; // default GLM rate (4.5/4.6/4.7 share pricing)
  }
  if (m.includes("deepseek")) {
    if (m.includes("r1") || m.includes("reason")) return RATES["deepseek-r1"];
    if (m.includes("v4")) return RATES["deepseek-v4-pro"];
    if (m.includes("v3.2")) return RATES["deepseek-v3.2"];
    if (m.includes("v3.1")) return RATES["deepseek-v3.1"];
    return RATES["deepseek-v3"]; // default chat tier
  }
  if (m.includes("qwen")) {
    if (m.includes("max")) return RATES["qwen3-max"];
    if (m.includes("flash")) return RATES["qwen3-flash"];
    if (m.includes("turbo")) return RATES["qwen-turbo"];
    return RATES["qwen3-plus"]; // default Qwen tier
  }
  if (m.includes("codestral")) return RATES["codestral"];
  if (m.includes("mistral") || m.includes("devstral")) {
    if (m.includes("small")) return RATES["mistral-small"];
    return RATES["mistral-large"];
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

  // 5. Unknown / proxy-routed model with no public price table — honest $0.
  //    (Self-hosted OLLAMA open-weights are genuinely free; untracked hosted
  //    models report $0 rather than a fabricated estimate.)
  return ZERO_RATE;
}

/** Compute USD cost for a token breakdown. Used only when the OpenCode
 *  `session.cost` column is 0 (proxy routing with no price table). */
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