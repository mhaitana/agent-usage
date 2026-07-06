# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only Next.js dashboard that reads coding-agent usage data live from your machine and renders token/cost/session analytics. No auth, no external requests. Claude Code, Codex, OpenCode, and Antigravity are wired up today; an **adapter seam** (`lib/adapters/`) makes adding others a new file, not a refactor. (The "no database" rule refers to the app's own state — there is no app DB. The OpenCode adapter *reads* an external SQLite db that OpenCode itself maintains; the app still writes nothing.)

**Routes:** `/` is the overview (per-agent summary cards + combined panels across all agents); `/{slug}` (e.g. `/claude`, `/codex`, `/opencode`, `/antigravity`) is a per-agent page with the same panels scoped to one adapter via `scopeDataset`. Unknown slugs 404. The header has a scope-switcher nav between them. **Antigravity is activity-only** — it doesn't write token/cost data to disk (usage accounting is server-side at Google, and external requests are forbidden), so its adapter reports `0` tokens / `$0` cost with `hasTokenData: false`, and `/antigravity` renders **activity panels** (sessions, messages, tool calls, models, projects) instead of token/cost panels. Claude, Codex, and OpenCode are token-bearing (`hasTokenData: true`) and feed the token/cost panels; the combined token/cost KPIs, daily chart, and model donut on the overview are Claude + Codex + OpenCode. Antigravity still contributes to Sessions/Tool-calls totals and appears in the sessions table + project breakdown.

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

**Adapter architecture:** each coding agent sits behind an `Adapter` (`lib/adapters/types.ts`) that owns its discovery (`isAvailable` / `discoverSessions`), parsing (`parseSession`), and (when it writes tokens) vendor pricing. Each `Adapter` also declares `hasTokenData: boolean` — `true` for tools that persist per-request token counts (Claude, Codex, OpenCode), `false` for activity-only tools (Antigravity). A tool-agnostic orchestrator (`lib/usage-data.ts`) holds the adapter registry (`ADAPTERS`), a generic in-memory mtime cache, and all aggregation into `UsageDataset` (`daily`, `byModel`, `byProject`, `totals`). `getUsageDataset()` fans out across registered adapters, caches each parsed session by `path + mtime + size`, and aggregates the normalized `Session[]` they return. `hasTokenData` flows onto `AdapterStatus` and `AgentCard` so the UI can switch to activity panels / `—` cells for token-less adapters.

The normalized `Session` shape (`lib/types.ts`) is a **superset** — it carries Anthropic's token taxonomy (input / cache-creation / cache-read / output). Future adapters map their vendor's tokens onto it, using `0` for fields they don't expose, so the shape and components stay stable when a new agent is added.

Key design points when editing:
- **Claude JSONL parsing** (`parseSessionFile` in `lib/adapters/claude.ts`): records have a `type` field. Only `assistant` and `user` contribute usage/messages; `ai-title` records supply the session title. Token fields come from `message.usage` on assistant records. Tool calls are counted by scanning `message.content` blocks for `type === "tool_use"`. Malformed lines are skipped defensively.
- **Codex rollout parsing** (`parseSessionFile` in `lib/adapters/codex.ts`): rollouts are JSONL under `~/.codex/sessions/YYYY/MM/DD/` + `~/.codex/archived_sessions/`. `session_meta` gives `cwd` (project = its basename) and the session id (`payload.id`, falling back to `payload.session_id` on newer versions). `turn_context.payload.model` precedes its turn's `token_count` records, so each `info.last_token_usage` **delta** is attributed to the most recent model (summing deltas gives the true total — `total_token_usage` is cumulative, don't sum it). Messages are `user_message`/`agent_message`; tool calls are `custom_tool_call`/`function_call`. Titles come from `~/.codex/session_index.jsonl` matched by session id. Token mapping: `inputTokens = input_tokens − cached_input_tokens`, `cacheReadTokens = cached_input_tokens`, `cacheCreationTokens = 0`, `outputTokens = output_tokens` (reasoning bundled in).
- **Antigravity transcript parsing** (`parseSessionFile` in `lib/adapters/antigravity.ts`) — **activity-only, no tokens**: transcripts are JSONL under `~/.gemini/antigravity-ide/brain/<uuid>/.system_generated/logs/transcript_full.jsonl` (falling back to `transcript.jsonl`). The brain-dir UUID is the session id. We do NOT parse the SQLite `~/.gemini/antigravity-ide/conversations/<uuid>.db` (encrypted protobuf, huge, no extra token data). Each record is `{ step_index, source, type, status, created_at, content?, tool_calls? }`. `USER_INPUT` → `messageCount++`; its `content` carries `<USER_SETTINGS_CHANGE>…to <Model>` (→ models — initial pick is a change from "None"), `Active Document: /path` (cwd fallback), and the first `<USER_REQUEST>` (→ title). `RUN_COMMAND` content's `CWD: /path` is the authoritative cwd (overrides Active Document); project = its basename. Tool calls = `tool_calls[]` on any record + `RUN_COMMAND`/`CODE_ACTION`/`VIEW_FILE`/`GREP_SEARCH`/`LIST_DIRECTORY`/`SEARCH_WEB` records without `tool_calls[]`. **All token + cost fields are `0`**; `hasTokenData: false`. When `ANTIGRAVITY_DIR` is unset, also scan legacy `~/.gemini/antigravity/brain`. Regex gotcha: the `Active Document` regex stops at `<` (a closing `</ADDITIONAL_METADATA>` tag contains a `/` that would corrupt `basename`), and the model regex stops at the tier `(` / sentence `. ` / `<` so names with dots like "Gemini 3.1 Pro" survive.
- **OpenCode SQLite parsing** (`loadSession` in `lib/adapters/opencode.ts`) — **token-bearing, SQLite, not JSONL**: sessions live in `~/.local/share/opencode/opencode.db` (WAL mode; overridable via `OPENCODE_DIR`). The `session` table already carries per-session aggregates — `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `cost` (real), `model` (JSON `{id, providerID, variant}`), `directory` (cwd → project = basename), `title`, `time_created`/`time_updated` (ms epochs). `messageCount`/`toolCallCount` come from `count(*)` subqueries on the `message` and `part` tables (`part.data` JSON `type === "tool"`). Opened read-only with `better-sqlite3` (`{ readonly: true, fileMustExist: true }`) so a live OpenCode process can keep writing (WAL allows concurrent readonly readers). Token mapping: `inputTokens = tokens_input`, `cacheReadTokens = tokens_cache_read`, `cacheCreationTokens = tokens_cache_write`, `outputTokens = tokens_output + tokens_reasoning` (reasoning bundled in, matching Codex), `totalTokens` = their sum. **Discovery is one `DiscoveredSession` per `session` row** with `key = dbPath + "#" + id` (unique per session) and `path = dbPath` (shared) — so the orchestrator's `stat(path)` mtime/size cache invalidates every row together when the db changes; `parseSession` recovers the id by splitting `key` on `"#"`. Subagent rows (`parent_id`) are included flat in V1. Empty/missing `model` column → fallback `"opencode"`.
- **In-memory mtime cache** (`parseWithCache` in `lib/usage-data.ts`): each parsed file is cached keyed by `path + mtime + size`, so re-rendering is cheap until a session file changes. This is a process-local cache — do not introduce disk-backed state without reason. It is **adapter-agnostic** — it stores the normalized `Session` returned by whichever adapter discovered the file. (For OpenCode all sessions share one `path = dbPath`, so a single db mtime change invalidates the whole adapter's rows at once.)
- **Scoping to one agent** (`scopeDataset` / `knownSlugs` / `perAdapterTotals` in `lib/usage-data.ts`): every `Session` carries an `adapter` slug (set by its adapter's `toSession`). The orchestrator always parses all registered adapters into one combined `UsageDataset`; per-agent pages filter `ds.sessions` by `adapter` and re-aggregate via the same internal `buildDataset`. Parsing happens once (cached); scoping is a cheap in-memory re-aggregation. Each `Adapter` also exposes a `slug` (route id) and `dirLabel()` (subtitle path); both surface on `AdapterStatus`.
- **Daily attribution**: each session's tokens are bucketed onto the day of its `lastSeen` (a session lands on one day, not spread across its duration). Preserve this if you touch the daily chart math.
- **Cost is API-price-equivalent**, *not* a subscription bill. Each vendor lives in its own `lib/pricing/<vendor>.ts` (`anthropic.ts` for Claude, `openai.ts` for Codex); each adapter imports its own. `rateFor()` resolves model ids by exact match → prefix match → family heuristic (Anthropic: `haiku`/`opus`/`sonnet`/`fable`; OpenAI: `mini`/`nano`/`pro`). Add new model rates to `RATES` when pricing changes; update the default fallback last. **OpenCode is multi-vendor** (`lib/pricing/opencode.ts`): a single install can route to any provider, and its `session.cost` column is `0` whenever the model is served via a proxy with no price table (e.g. an OLLAMA gateway fronting `glm-5.2`/`kimi-k2.7-code`). When `cost` is 0, the adapter recomputes from tokens via `opencode.rateFor`, which delegates `claude-*` to `anthropic.rateFor` and `gpt-5*`/`o*` to `openai.rateFor` (single source of truth — no drift with the Claude/Codex adapters), then resolves against its own comprehensive `RATES` table + family heuristics covering OpenAI's gpt-4.1/gpt-4o families, Google Gemini, Zhipu GLM (incl. `glm-5.2`), Moonshot Kimi (incl. `kimi-k2.7-code`), DeepSeek, Alibaba Qwen, and Mistral/Codestral. Unknown ids (e.g. self-hosted OLLAMA open-weights, or an untracked hosted model) fall back to an honest `$0` rather than a fabricated price. Non-Anthropic providers don't charge a separate cache-creation write fee, so `cacheWrite` is 0 for every rate defined in `opencode.ts` (only the delegated Anthropic rates carry a non-zero `cacheWrite`). Add a new `RATES` entry + heuristic branch when a vendor changes pricing or you want to cover another provider.
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

1. Create `lib/adapters/<tool>.ts` implementing `Adapter` from `lib/adapters/types.ts` (`name`, `slug`, `hasTokenData`, `isAvailable`, `discoverSessions`, `parseSession` → normalized `Session`, `dirLabel`). Set `adapter: "<slug>"` on the `Session` returned by `toSession`. The `slug` becomes the per-agent route (`/<slug>`) + nav pill automatically. Set `hasTokenData: false` if the tool keeps usage server-side — the UI then auto-switches `/slug` to activity panels (sessions/messages/tool calls/models/projects), the overview hub card to activity stats, and the sessions table to `—`/dropped token+cost columns; no component edits needed. **If the tool stores sessions in SQLite** (OpenCode, Goose), use `better-sqlite3` opened read-only; emit one `DiscoveredSession` per row with `key = dbPath + "#" + rowId` and `path = dbPath` (shared) so the mtime cache invalidates all rows together, and add `"better-sqlite3"` to `serverExternalPackages` in `next.config.ts` so the native binary isn't bundled.
2. Add vendor pricing **only if `hasTokenData: true`** (new file `lib/pricing/<vendor>.ts` if a new vendor, alongside `anthropic.ts` / `openai.ts` / `opencode.ts`). Activity-only adapters skip pricing — there are no tokens to price. Multi-vendor tools (OpenCode) keep one comprehensive `RATES` table per adapter file, delegating to the existing single-vendor modules where their ids overlap (OpenCode delegates `claude-*` to `anthropic.ts` and `gpt-5*`/`o*` to `openai.ts`) and defining the rest inline, with an honest `$0` fallback for unknown ids.
3. Register the adapter in `ADAPTERS` (`lib/usage-data.ts`).
4. Read the tool's data-dir env override inside the adapter (mirrors `CLAUDE_DIR` / `CODEX_DIR` / `ANTIGRAVITY_DIR` / `OPENCODE_DIR`).

No other files should need to change — orchestrator, cache, aggregation, scoping, routes, and all components stay as-is.

## Future adapters (not built yet)

Candidates ranked by token-data availability + fit with existing patterns (none are installed on this machine, so each needs local recon first):

1. **Goose (Block)** — `~/.local/share/goose/sessions/sessions.db` (SQLite, v1.10+) + legacy `.jsonl`. `sessions` table has `total_tokens`/`input_tokens`/`output_tokens`/`working_dir`/`provider_name`/`model_config`. Has tokens, no cost column → compute via pricing. **Reuses the OpenCode SQLite pattern** (better-sqlite3 readonly) — lowest marginal effort.
2. **Continue** — `~/.continue/sessions/*.jsonl` with per-message token counts. Has tokens. **Reuses the Claude/Codex JSONL streaming pattern** — no native dep.
3. **Aider** — per-project `.aider.chat.history.md` (markdown) + `.aider.llm.history` (raw JSON-ish LLM log with token/cost per call). Has tokens + cost. Moderate effort (markdown + llm.history parsing; per-project discovery across git roots is messy). Popular open-source CLI.
4. **Sourcegraph Amp** (`~/.amp`), **Zed AI** (`~/.zed`), **Charm Crush** (`~/.crush`) — likely have sessions; format needs recon.
5. **Cursor / Windsurf / GitHub Copilot Chat / Roo Code / Cline** — IDE-backed, opaque storage (SQLite/LevelDB in `~/Library/Application Support/…` or VSCode `workspaceStorage`), proprietary and version-unstable — higher maintenance tier.

Build Goose or Continue next (pattern reuse). Aider is worth it for popularity but is the messiest parse.

## Data path override

Set `CLAUDE_DIR=/path/to/.claude`, `CODEX_DIR=/path/to/.codex`, `ANTIGRAVITY_DIR=/path/to/.gemini/antigravity-ide`, or `OPENCODE_DIR=/path/to/.local/share/opencode` to point at an alternate config dir (e.g. for testing). Each adapter reads its own env var; it flows into every file lookup. Each adapter owns its own env override.

**Enable/disable adapters:** set `<SLUG>_ENABLED=0|false|no|off` (slug uppercased: `CLAUDE_ENABLED`, `CODEX_ENABLED`, `OPENCODE_ENABLED`, `ANTIGRAVITY_ENABLED`) to turn an adapter off. Unset → enabled. A disabled adapter drops out completely — no hub card, no nav pill, no per-agent route (its `/<slug>` 404s), and no contribution to combined totals — distinct from `isAvailable()` (data dir missing → muted "Not found" card). The flag is resolved in the orchestrator (`isEnabled` / `registeredAdapters` in `lib/usage-data.ts`) from the adapter's slug, so `getUsageDataset` / `knownSlugs` / `adapterMeta` all stay consistent and no per-adapter code is needed.