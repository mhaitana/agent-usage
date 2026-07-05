# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only Next.js dashboard that reads coding-agent usage data live from your machine and renders token/cost/session analytics. No database, no auth, no external requests. Claude Code and Codex are wired up today; an **adapter seam** (`lib/adapters/`) makes adding Antigravity / others a new file, not a refactor.

**Routes:** `/` is the overview (per-agent summary cards + combined panels across all agents); `/{slug}` (e.g. `/claude`, `/codex`) is a per-agent page with the same panels scoped to one adapter via `scopeDataset`. Unknown slugs 404. The header has a scope-switcher nav between them.

## Stack

- Next.js 16.2 (App Router) + React 19 + TypeScript, pnpm.
- Tailwind v4 (`@import "tailwindcss"` in `app/globals.css`; **no `tailwind.config`**).
- Recharts 3 for charts.

> **Next.js version warning:** this is Next 16 — APIs/conventions may differ from your training data. Read `node_modules/next/dist/docs/` before touching Next APIs. Heed deprecation notices.

## Commands

```bash
pnpm dev          # dev server on http://localhost:3000
pnpm build        # production build
pnpm type-check   # tsc --noEmit
pnpm lint         # eslint .
```

No test suite exists yet.

## Architecture

The whole app is an overview page (`app/page.tsx`) plus a dynamic per-agent page (`app/[agent]/page.tsx`) plus one JSON API route (`app/api/usage/route.ts`). All are `force-dynamic` — data is always read live, never cached.

**Adapter architecture:** each coding agent sits behind an `Adapter` (`lib/adapters/types.ts`) that owns its discovery (`isAvailable` / `discoverSessions`), parsing (`parseSession`), and vendor pricing. A tool-agnostic orchestrator (`lib/usage-data.ts`) holds the adapter registry (`ADAPTERS`), a generic in-memory mtime cache, and all aggregation into `UsageDataset` (`daily`, `byModel`, `byProject`, `totals`). `getUsageDataset()` fans out across registered adapters, caches each parsed session by `path + mtime + size`, and aggregates the normalized `Session[]` they return.

The normalized `Session` shape (`lib/types.ts`) is a **superset** — it carries Anthropic's token taxonomy (input / cache-creation / cache-read / output). Future adapters map their vendor's tokens onto it, using `0` for fields they don't expose, so the shape and components stay stable when a new agent is added.

Key design points when editing:
- **Claude JSONL parsing** (`parseSessionFile` in `lib/adapters/claude.ts`): records have a `type` field. Only `assistant` and `user` contribute usage/messages; `ai-title` records supply the session title. Token fields come from `message.usage` on assistant records. Tool calls are counted by scanning `message.content` blocks for `type === "tool_use"`. Malformed lines are skipped defensively.
- **Codex rollout parsing** (`parseSessionFile` in `lib/adapters/codex.ts`): rollouts are JSONL under `~/.codex/sessions/YYYY/MM/DD/` + `~/.codex/archived_sessions/`. `session_meta` gives `cwd` (project = its basename) and the session id (`payload.id`, falling back to `payload.session_id` on newer versions). `turn_context.payload.model` precedes its turn's `token_count` records, so each `info.last_token_usage` **delta** is attributed to the most recent model (summing deltas gives the true total — `total_token_usage` is cumulative, don't sum it). Messages are `user_message`/`agent_message`; tool calls are `custom_tool_call`/`function_call`. Titles come from `~/.codex/session_index.jsonl` matched by session id. Token mapping: `inputTokens = input_tokens − cached_input_tokens`, `cacheReadTokens = cached_input_tokens`, `cacheCreationTokens = 0`, `outputTokens = output_tokens` (reasoning bundled in).
- **In-memory mtime cache** (`parseWithCache` in `lib/usage-data.ts`): each parsed file is cached keyed by `path + mtime + size`, so re-rendering is cheap until a session file changes. This is a process-local cache — do not introduce disk-backed state without reason. It is **adapter-agnostic** — it stores the normalized `Session` returned by whichever adapter discovered the file.
- **Scoping to one agent** (`scopeDataset` / `knownSlugs` / `perAdapterTotals` in `lib/usage-data.ts`): every `Session` carries an `adapter` slug (set by its adapter's `toSession`). The orchestrator always parses all registered adapters into one combined `UsageDataset`; per-agent pages filter `ds.sessions` by `adapter` and re-aggregate via the same internal `buildDataset`. Parsing happens once (cached); scoping is a cheap in-memory re-aggregation. Each `Adapter` also exposes a `slug` (route id) and `dirLabel()` (subtitle path); both surface on `AdapterStatus`.
- **Daily attribution**: each session's tokens are bucketed onto the day of its `lastSeen` (a session lands on one day, not spread across its duration). Preserve this if you touch the daily chart math.
- **Cost is API-price-equivalent**, *not* a subscription bill. Each vendor lives in its own `lib/pricing/<vendor>.ts` (`anthropic.ts` for Claude, `openai.ts` for Codex); each adapter imports its own. `rateFor()` resolves model ids by exact match → prefix match → family heuristic (Anthropic: `haiku`/`opus`/`sonnet`/`fable`; OpenAI: `mini`/`nano`/`pro`). Add new model rates to `RATES` when pricing changes; update the default fallback last.
- **Colors**: chart data marks use the pastel `--chart-1..8` CSS variables (defined in `app/globals.css`); `lib/palette.ts` mirrors them for chart series. KPI sparklines keep the vibrant `--series-*` set. Model→color mapping is stable by sorted model name (`buildColorMap`). Theme switching is via `data-theme` on `<html>` (resolved by a boot script, not a CSS media query). Do not hardcode hex colors in components — use the vars.
- **Project names**: each adapter humanizes its own tool's slugs. The Claude adapter's `humanizeProjectSlug` strips the `-Users-...-Projects-` prefix of Claude Code's session-dir slugs — adjust the markers there if slugs change shape. The Codex adapter uses the `basename` of the session's `cwd` (Codex records the real cwd, so there's nothing to strip).
- `lib/format.ts` holds all display formatters (`formatTokens`, `formatCost`, `formatDuration`, `formatDate`). Reuse them rather than re-implementing.

Components are presentational and receive pre-aggregated slices of `UsageDataset`:

| Component | Input |
|---|---|
| `AgentCards` | overview-only hub cards: `adapters` merged with `perAdapterTotals(ds)` |
| `KpiTiles` | `totals` + `daily` |
| `DailyChart` | `daily[]` (stacked by model) |
| `ModelBreakdown` | `byModel[]` |
| `ProjectBreakdown` | `byProject[]` |
| `SessionTable` | `sessions[]` |

## Adding a new agent

1. Create `lib/adapters/<tool>.ts` implementing `Adapter` from `lib/adapters/types.ts` (`name`, `slug`, `isAvailable`, `discoverSessions`, `parseSession` → normalized `Session`, `dirLabel`). Set `adapter: "<slug>"` on the `Session` returned by `toSession`. The `slug` becomes the per-agent route (`/<slug>`) + nav pill automatically.
2. Add vendor pricing (new file `lib/pricing/<vendor>.ts` if a new vendor, alongside `anthropic.ts` / `openai.ts`).
3. Register the adapter in `ADAPTERS` (`lib/usage-data.ts`).
4. Read the tool's data-dir env override inside the adapter (mirrors `CLAUDE_DIR` / `CODEX_DIR`).

No other files should need to change — orchestrator, cache, aggregation, scoping, routes, and all components stay as-is.

## Data path override

Set `CLAUDE_DIR=/path/to/.claude` or `CODEX_DIR=/path/to/.codex` to point at an alternate config dir (e.g. for testing). Each adapter reads its own env var; it flows into every file lookup. Each adapter owns its own env override (the pattern a future `ANTIGRAVITY_DIR` would follow).