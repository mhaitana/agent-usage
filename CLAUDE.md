# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only Next.js dashboard that reads coding-agent usage data live from your machine and renders token/cost/session analytics. No database, no auth, no external requests. Claude Code, Codex, and Antigravity are wired up today; an **adapter seam** (`lib/adapters/`) makes adding others a new file, not a refactor.

**Routes:** `/` is the overview (per-agent summary cards + combined panels across all agents); `/{slug}` (e.g. `/claude`, `/codex`, `/antigravity`) is a per-agent page with the same panels scoped to one adapter via `scopeDataset`. Unknown slugs 404. The header has a scope-switcher nav between them. **Antigravity is activity-only** — it doesn't write token/cost data to disk (usage accounting is server-side at Google, and external requests are forbidden), so its adapter reports `0` tokens / `$0` cost with `hasTokenData: false`, and `/antigravity` renders **activity panels** (sessions, messages, tool calls, models, projects) instead of token/cost panels. The combined token/cost KPIs, daily chart, and model donut on the overview stay Claude + Codex only; Antigravity still contributes to Sessions/Tool-calls totals and appears in the sessions table + project breakdown.

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

**Adapter architecture:** each coding agent sits behind an `Adapter` (`lib/adapters/types.ts`) that owns its discovery (`isAvailable` / `discoverSessions`), parsing (`parseSession`), and (when it writes tokens) vendor pricing. Each `Adapter` also declares `hasTokenData: boolean` — `true` for tools that persist per-request token counts (Claude, Codex), `false` for activity-only tools (Antigravity). A tool-agnostic orchestrator (`lib/usage-data.ts`) holds the adapter registry (`ADAPTERS`), a generic in-memory mtime cache, and all aggregation into `UsageDataset` (`daily`, `byModel`, `byProject`, `totals`). `getUsageDataset()` fans out across registered adapters, caches each parsed session by `path + mtime + size`, and aggregates the normalized `Session[]` they return. `hasTokenData` flows onto `AdapterStatus` and `AgentCard` so the UI can switch to activity panels / `—` cells for token-less adapters.

The normalized `Session` shape (`lib/types.ts`) is a **superset** — it carries Anthropic's token taxonomy (input / cache-creation / cache-read / output). Future adapters map their vendor's tokens onto it, using `0` for fields they don't expose, so the shape and components stay stable when a new agent is added.

Key design points when editing:
- **Claude JSONL parsing** (`parseSessionFile` in `lib/adapters/claude.ts`): records have a `type` field. Only `assistant` and `user` contribute usage/messages; `ai-title` records supply the session title. Token fields come from `message.usage` on assistant records. Tool calls are counted by scanning `message.content` blocks for `type === "tool_use"`. Malformed lines are skipped defensively.
- **Codex rollout parsing** (`parseSessionFile` in `lib/adapters/codex.ts`): rollouts are JSONL under `~/.codex/sessions/YYYY/MM/DD/` + `~/.codex/archived_sessions/`. `session_meta` gives `cwd` (project = its basename) and the session id (`payload.id`, falling back to `payload.session_id` on newer versions). `turn_context.payload.model` precedes its turn's `token_count` records, so each `info.last_token_usage` **delta** is attributed to the most recent model (summing deltas gives the true total — `total_token_usage` is cumulative, don't sum it). Messages are `user_message`/`agent_message`; tool calls are `custom_tool_call`/`function_call`. Titles come from `~/.codex/session_index.jsonl` matched by session id. Token mapping: `inputTokens = input_tokens − cached_input_tokens`, `cacheReadTokens = cached_input_tokens`, `cacheCreationTokens = 0`, `outputTokens = output_tokens` (reasoning bundled in).
- **Antigravity transcript parsing** (`parseSessionFile` in `lib/adapters/antigravity.ts`) — **activity-only, no tokens**: transcripts are JSONL under `~/.gemini/antigravity-ide/brain/<uuid>/.system_generated/logs/transcript_full.jsonl` (falling back to `transcript.jsonl`). The brain-dir UUID is the session id. We do NOT parse the SQLite `~/.gemini/antigravity-ide/conversations/<uuid>.db` (encrypted protobuf, huge, no extra token data). Each record is `{ step_index, source, type, status, created_at, content?, tool_calls? }`. `USER_INPUT` → `messageCount++`; its `content` carries `<USER_SETTINGS_CHANGE>…to <Model>` (→ models — initial pick is a change from "None"), `Active Document: /path` (cwd fallback), and the first `<USER_REQUEST>` (→ title). `RUN_COMMAND` content's `CWD: /path` is the authoritative cwd (overrides Active Document); project = its basename. Tool calls = `tool_calls[]` on any record + `RUN_COMMAND`/`CODE_ACTION`/`VIEW_FILE`/`GREP_SEARCH`/`LIST_DIRECTORY`/`SEARCH_WEB` records without `tool_calls[]`. **All token + cost fields are `0`**; `hasTokenData: false`. When `ANTIGRAVITY_DIR` is unset, also scan legacy `~/.gemini/antigravity/brain`. Regex gotcha: the `Active Document` regex stops at `<` (a closing `</ADDITIONAL_METADATA>` tag contains a `/` that would corrupt `basename`), and the model regex stops at the tier `(` / sentence `. ` / `<` so names with dots like "Gemini 3.1 Pro" survive.
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
| `AgentCards` | overview-only hub cards: `adapters` merged with `perAdapterTotals(ds)`; token-less cards show Sessions/Messages/Tool calls instead of Tokens/Est. cost |
| `KpiTiles` | `totals` + `daily` (+ optional `byModel`/`byProject` for `mode="activity"`) |
| `DailyChart` | `daily[]` (stacked by model); `mode="sessions"` → single sessions-per-day area |
| `ModelBreakdown` | `byModel[]`; `mode="sessions"` → donut of sessions per model (token mode filters out 0-token models) |
| `ProjectBreakdown` | `byProject[]`; `metric="sessions"` → ranked by session count (token mode filters 0-token projects) |
| `SessionTable` | `sessions[]` + optional `tokenLessAdapters: Set<string>` (drops token/cost columns when all rows are token-less; renders `—` for token-less rows in mixed tables) |

## Adding a new agent

1. Create `lib/adapters/<tool>.ts` implementing `Adapter` from `lib/adapters/types.ts` (`name`, `slug`, `hasTokenData`, `isAvailable`, `discoverSessions`, `parseSession` → normalized `Session`, `dirLabel`). Set `adapter: "<slug>"` on the `Session` returned by `toSession`. The `slug` becomes the per-agent route (`/<slug>`) + nav pill automatically. Set `hasTokenData: false` if the tool keeps usage server-side — the UI then auto-switches `/slug` to activity panels (sessions/messages/tool calls/models/projects), the overview hub card to activity stats, and the sessions table to `—`/dropped token+cost columns; no component edits needed.
2. Add vendor pricing **only if `hasTokenData: true`** (new file `lib/pricing/<vendor>.ts` if a new vendor, alongside `anthropic.ts` / `openai.ts`). Activity-only adapters skip pricing — there are no tokens to price.
3. Register the adapter in `ADAPTERS` (`lib/usage-data.ts`).
4. Read the tool's data-dir env override inside the adapter (mirrors `CLAUDE_DIR` / `CODEX_DIR` / `ANTIGRAVITY_DIR`).

No other files should need to change — orchestrator, cache, aggregation, scoping, routes, and all components stay as-is.

## Data path override

Set `CLAUDE_DIR=/path/to/.claude`, `CODEX_DIR=/path/to/.codex`, or `ANTIGRAVITY_DIR=/path/to/.gemini/antigravity-ide` to point at an alternate config dir (e.g. for testing). Each adapter reads its own env var; it flows into every file lookup. Each adapter owns its own env override.