# Agent Usage Dashboard

A local-only Next.js dashboard that reads **coding-agent usage data live** from
your machine and renders token, cost, session, and project analytics. No
database, no auth, no external requests — everything runs against your own
session transcripts.

Today it reads **Claude Code** (`~/.claude/projects/*/*.jsonl`), **Codex**
(`~/.codex/sessions/**/*.jsonl` + `~/.codex/archived_sessions/*.jsonl`), and
**Antigravity** (`~/.gemini/antigravity-ide/brain/<uuid>/.system_generated/logs/transcript*.jsonl`).
The architecture is built around an **adapter seam** so that adding another
agent later is a new file, not a refactor — see
[Adding a new agent](#adding-a-new-agent).

> **Antigravity is activity-only.** It doesn't write per-request token usage or
> cost to disk (usage accounting is server-side at Google), so its adapter
> honestly reports `0` tokens / `$0` cost and the UI shows **activity panels**
> (sessions, messages, tool calls, models, projects) on `/antigravity` instead
> of the token/cost panels. The combined token/cost KPIs, daily chart, and
> model donut on the overview stay Claude + Codex only — Antigravity still
> contributes to the Sessions and Tool-calls totals and appears in the
> sessions table and project breakdown.

![Stack](https://img.shields.io/badge/Next.js-16.2-black) ![React](https://img.shields.io/badge/React-19-149eca) ![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8) ![Recharts](https://img.shields.io/badge/Recharts-3-22c55e)

---

## What it shows

A dashboard built from your agent session logs, with a scope switcher in the
header:

- **`/` — overview.** One summary card per agent (sessions + tokens/cost for
  token-bearing agents, or sessions/messages/tool calls for activity-only
  agents) above the combined panels across **all** agents.
- **`/{slug}` — per-agent.** The same panels scoped to a single agent:
  [`/claude`](http://localhost:3000/claude) (Claude Code),
  [`/codex`](http://localhost:3000/codex) (Codex), and
  [`/antigravity`](http://localhost:3000/antigravity) (Antigravity — activity
  panels). An unknown slug 404s.

| Panel | What it renders |
|---|---|
| **Agent cards** *(overview only)* | One clay card per agent: session count + (tokens/est. cost, or messages/tool calls for activity-only agents), linking to its page. |
| **KPI tiles** | Total tokens, est. cost, sessions, tool calls, cache-read tokens, active window — each with a sparkline trend. *(Activity mode: sessions, messages, tool calls, models, projects, active window.)* |
| **Daily tokens** | Stacked area chart of tokens per day, split by model. Click a legend item to toggle a model on/off. *(Activity mode: single sessions-per-day area.)* |
| **By model** | Donut of each model's share of total tokens, with a per-model share bar, token count, and API-price-equivalent cost. *(Activity mode: donut of each model's share of sessions.)* |
| **By project** | Horizontal bar chart of the top 12 projects by token volume, with cost and session counts. *(Activity mode: ranked by session count.)* |
| **Sessions** | Sortable, filterable table of every session — last seen, project, title, models, messages, tool calls, tokens, cost, duration. Activity-only rows show `—` for tokens/cost; on `/antigravity` those columns are dropped entirely. |

All numbers are computed live from the transcripts on every request — nothing
is cached to disk, nothing leaves your machine.

---

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

That's it. The app reads `~/.claude/projects/*/*.jsonl`,
`~/.codex/sessions/**/*.jsonl`, and
`~/.gemini/antigravity-ide/brain/<uuid>/.system_generated/logs/transcript*.jsonl`
from your machine and renders the dashboard. If you've used Claude Code, Codex,
and/or Antigravity in this directory tree, you'll see data immediately.

### Prerequisites

- Node.js 20+ (Node 24 is used in development)
- pnpm 10+ (`corepack enable` if you don't have it)
- Existing transcripts under `~/.claude/projects/` and/or
  `~/.codex/sessions/` and/or `~/.gemini/antigravity-ide/brain/`

### Other commands

```bash
pnpm build        # production build
pnpm start         # serve the production build
pnpm type-check    # tsc --noEmit
pnpm lint          # eslint .
```

> No test suite exists yet.

---

## How it works

### Adapter architecture

Each coding agent is behind an `Adapter` (`lib/adapters/types.ts`) that owns
three things: **where** the tool stores sessions, **how** to parse them, and
**what** they cost (vendor pricing). A tool-agnostic orchestrator
(`lib/usage-data.ts`) fans out across registered adapters, caches parsed
sessions by file mtime, and aggregates everything into one `UsageDataset`.

```
~/.claude/projects/*/*.jsonl          ~/.codex/sessions/**/*.jsonl
                                      ~/.codex/archived_sessions/*.jsonl
        │                                  │
        ▼                                  ▼
lib/adapters/claude.ts   claudeAdapter   lib/adapters/codex.ts   codexAdapter
   (DiscoveredSession[] → Session[])         (DiscoveredSession[] → Session[])
   + Anthropic pricing                       + OpenAI pricing
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
lib/usage-data.ts        getUsageDataset()           ← orchestrator
   • adapter registry (ADAPTERS)
   • in-memory mtime cache (parseWithCache)
   • aggregates → daily / byModel / byProject / totals
        ▼
app/api/usage/route.ts   →  UsageDataset JSON
app/page.tsx             →  renders the dashboard (force-dynamic, live read)
```

The normalized `Session` shape (`lib/types.ts`) is the **superset** of what
each adapter produces. Today it carries Anthropic's token taxonomy
(input / cache-creation / cache-read / output). Future adapters map their
vendor's tokens onto it, using `0` for fields they don't expose — so the shape
stays stable and components never churn when a new agent is added.

### Claude Code parsing (`lib/adapters/claude.ts`)

Each Claude session is a newline-delimited JSON file. Records have a `type`:

- **`assistant`** and **`user`** records contribute usage + message counts.
  Token fields come from `message.usage` on assistant records.
- **`ai-title`** records supply the session title.
- **Tool calls** are counted by scanning `message.content` blocks for
  `type === "tool_use"`.
- Malformed lines are skipped defensively — a single bad record never breaks
  the whole session.

### Codex parsing (`lib/adapters/codex.ts`)

Codex stores session rollouts as JSONL under `~/.codex/sessions/YYYY/MM/DD/`
(nested by date) and `~/.codex/archived_sessions/` (flat), plus a
`~/.codex/session_index.jsonl` id→title index. Each rollout record has a
top-level `type`:

- **`session_meta`** supplies the `cwd` (→ project name = its basename) and the
  session id (`payload.id`, with `payload.session_id` as a fallback on newer
  versions).
- **`turn_context`** carries `payload.model` for the upcoming turn (e.g.
  `gpt-5.5`). It **precedes** that turn's `token_count` records, so each
  token delta is attributed to the most recent model.
- **`token_count`** (inside `event_msg`) carries `info.last_token_usage`, a
  **per-response delta** (not the cumulative `total_token_usage`). Summing
  deltas gives the true per-session total without double-counting.
- **Messages** are `user_message` / `agent_message` event payloads; **tool
  calls** are `custom_tool_call` / `function_call` response items.
- Session **titles** are looked up from `session_index.jsonl` by session id.

Codex's token taxonomy maps onto the normalized shape as: `inputTokens` =
`input_tokens − cached_input_tokens`, `cacheReadTokens` =
`cached_input_tokens`, `cacheCreationTokens` = 0 (Codex has no cache-creation
field), `outputTokens` = `output_tokens` (reasoning tokens are bundled in).
Cost uses OpenAI gpt-5 list prices (`lib/pricing/openai.ts`).

### Antigravity parsing (`lib/adapters/antigravity.ts`) — activity-only

Antigravity stores conversation history under
`~/.gemini/antigravity-ide/brain/<uuid>/.system_generated/logs/transcript_full.jsonl`
(falling back to `transcript.jsonl` when `_full` is absent). The brain-dir UUID
is the session id. We deliberately do **not** parse the SQLite
`~/.gemini/antigravity-ide/conversations/<uuid>.db` files — they're large,
partially encrypted protobuf blobs, and carry no token data the transcripts
don't. Each transcript line is a loose `{ step_index, source, type, status,
created_at, content?, tool_calls? }` record:

- **`USER_INPUT`** records are user messages (→ `messageCount`). Their `content`
  carries `<USER_SETTINGS_CHANGE>…to <Model>` blocks (the initial model pick is
  recorded as a change from "None", so most sessions expose their model), an
  `Active Document: /path` metadata line (a cwd fallback), and the first
  `<USER_REQUEST>` (→ session title).
- **`RUN_COMMAND`** content carries an authoritative `CWD: /path` line (→
  project = its basename, overriding the Active Document fallback).
- **Tool calls** come from `tool_calls[]` arrays on `PLANNER_RESPONSE` records
  plus `RUN_COMMAND` / `CODE_ACTION` / `VIEW_FILE` / `GREP_SEARCH` /
  `LIST_DIRECTORY` / `SEARCH_WEB` records that have no explicit `tool_calls[]`.
- **Tokens / cost are all `0`** — Antigravity keeps usage server-side; nothing
  is read from disk and no external request is made. The adapter sets
  `hasTokenData: false`, so the UI swaps to activity panels on `/antigravity`.

When `ANTIGRAVITY_DIR` is unset, the adapter also scans the legacy
`~/.gemini/antigravity/brain` tree (pre-IDE-split data); with an override it
scans only the override.

### In-memory mtime cache

Each parsed session is cached keyed by `path + mtime + size`, so re-rendering
is cheap until a session file actually changes. This is a **process-local**
cache — there is no disk-backed state, intentionally. Don't introduce any.

### Scoping to one agent (`scopeDataset`)

Every normalized `Session` carries an `adapter` slug (set by its adapter's
`toSession`). The orchestrator always parses **all** registered adapters into
one combined `UsageDataset`; per-agent pages (`/{slug}`) then call
`scopeDataset(ds, slug)` (`lib/usage-data.ts`), which filters `ds.sessions` by
`adapter` and re-aggregates via the same `buildDataset` used for the overview.
Parsing happens once (cached); scoping is a cheap in-memory re-aggregation.
`knownSlugs()` validates the route param (unknown slugs 404), and
`perAdapterTotals(ds)` feeds the overview hub cards.

### Daily attribution

Each session's tokens are bucketed onto the **day of its `lastSeen`** — a
session lands on one day, not spread across its duration. Preserve this if you
touch the daily chart math.

### Cost is API-price-equivalent, not your bill

`lib/pricing/anthropic.ts` estimates cost from public Anthropic API list
prices. Claude Code subscriptions (Pro / Max) are **not** pay-per-token — these
numbers are a rough gauge of value/volume, not what you're actually charged.
`rateFor()` resolves model ids by **exact match → prefix match → family
heuristic** (`haiku` / `opus` / `sonnet` / `fable`). When Anthropic pricing
changes, add new rates to `RATES`; update `DEFAULT_RATE` last.

> Each vendor lives in its own `lib/pricing/<vendor>.ts` (`anthropic.ts`,
> `openai.ts`, …). `openai.ts` follows the same pattern with gpt-5 / gpt-5-mini
> / gpt-5-nano / gpt-5-pro rates; Codex subscriptions aren't pay-per-token
> either, so its numbers are the same API-price-equivalent gauge.

---

## Project structure

```
app/
  layout.tsx            root layout + no-FOUC theme boot script
  page.tsx              overview (/) — per-agent cards + combined panels
  [agent]/page.tsx      per-agent page (/{slug}) — panels scoped to one adapter
  globals.css           design tokens + claymorphism × neo-brutalism styles
  api/usage/route.ts    JSON API → UsageDataset (all agents)
components/
  DashboardHeader.tsx  hero band, title, scope-switcher nav, refresh, theme switcher
  AgentCards.tsx        overview hub cards (one per agent, link to its page)
  SiteFooter.tsx        shared footer (token caveat + GitHub pill)
  KpiTiles.tsx         pastel block KPI tiles + sparklines
  DailyChart.tsx       stacked area chart by model
  ModelBreakdown.tsx   donut + per-model share bars
  ProjectBreakdown.tsx horizontal bar chart
  SessionTable.tsx     sortable/filterable sessions table
  ThemeSwitcher.tsx    System / Light / Dark switcher
  ui/                  Card, icons, Sparkline primitives
lib/
  adapters/
    types.ts        Adapter, DiscoveredSession interfaces (slug + hasTokenData + dirLabel)
    claude.ts       Claude Code adapter (JSONL, paths, slug humanizing, Anthropic cost)
    codex.ts        Codex adapter (rollout JSONL, cwd-basename projects, OpenAI cost)
    antigravity.ts  Antigravity adapter (transcript JSONL, activity-only, no tokens/cost)
  usage-data.ts     orchestrator: registry, mtime cache, aggregation, scopeDataset
  format.ts         display formatters (formatTokens, formatCost, tilde, …)
  palette.ts        model → color mapping (chart series)
  pricing/
    anthropic.ts    Anthropic API-price-equivalent cost (Claude adapter imports)
    openai.ts       OpenAI API-price-equivalent cost (Codex adapter imports)
  types.ts          shared types (UsageDataset, Session.adapter, AdapterStatus, …)
```

### Components are presentational

Each component receives a pre-aggregated slice of `UsageDataset`:

| Component | Input |
|---|---|
| `KpiTiles` | `totals` + `daily` |
| `DailyChart` | `daily[]` (stacked by model) |
| `ModelBreakdown` | `byModel[]` |
| `ProjectBreakdown` | `byProject[]` |
| `SessionTable` | `sessions[]` |

---

## Adding a new agent

To support a new tool (Codex, Antigravity, …):

1. **Create the adapter** — `lib/adapters/<tool>.ts` implementing `Adapter`
   from `lib/adapters/types.ts`:
   - `name` — display name ("Antigravity").
   - `slug` — URL-safe id (`"antigravity"`); becomes the per-agent route
     (`/antigravity`) and nav pill automatically.
   - `hasTokenData` — `true` if the tool writes per-request token counts to disk
     (Claude, Codex); `false` if it keeps usage server-side (Antigravity). When
     `false`, the per-agent page renders activity panels (sessions, messages,
     tool calls, models, projects) instead of token/cost panels, the overview
     hub card shows activity stats, and the sessions table drops/`—`s the
     token + cost columns for that adapter.
   - `isAvailable()` — `stat` the tool's data dir; return false if missing.
   - `discoverSessions()` — walk the tool's data dir and return
     `DiscoveredSession[]` (`{ key, path, projectSlug }`).
   - `parseSession(d)` — read `d.path`, map the tool's raw records onto the
     normalized `Session` shape (zeros for token fields it doesn't expose),
     set `adapter: "<slug>"` on the returned `Session`, compute cost via its
     vendor pricing (skip pricing entirely if `hasTokenData: false`).
   - `dirLabel()` — display path for the header subtitle (e.g. `~/.antigravity`).
2. **Add pricing** *(only if `hasTokenData: true`)* — for a new vendor, create
   `lib/pricing/<vendor>.ts` with a `costOf(...)` matching the existing
   `anthropic.ts` / `openai.ts` ones. Activity-only adapters skip this — there
   are no tokens to price.
3. **Register it** — add the adapter to `ADAPTERS` in `lib/usage-data.ts`.
4. **Env override** — if the tool's data dir is configurable, read its env var
   inside the adapter (e.g. `ANTIGRAVITY_DIR`), mirroring the `CLAUDE_DIR` pattern.

No other files should need to change — the orchestrator, cache, aggregation,
scoping, routes, and all components stay as-is. The new tool gets a nav pill,
an overview hub card, and its own `/<slug>` page for free, and its sessions
merge into the combined `UsageDataset` on the overview.

---

## Design system — Claymorphism × Neo-brutalism

The dashboard uses a claymorphism × neo-brutalism design language (cream page,
white cards with **3px solid dark-slate borders**, **hard offset shadows** with
no blur, a subtle inset bottom for the clay puff, and a pastel block palette).

### Theming

- **Three-way theme switcher**: System / Light / Dark, persisted to
  `localStorage` and applied via a `data-theme` attribute on `<html>`.
- **No FOUC**: a blocking inline boot script in `app/layout.tsx` resolves the
  theme **before first paint**. "System" is resolved to light/dark via
  `matchMedia("(prefers-color-scheme: dark)")` in the boot script — the CSS
  itself has no `@media (prefers-color-scheme)` block, so dark tokens live in
  one place only (`:root[data-theme="dark"]`).
- **ThemeSwitcher** uses `useSyncExternalStore` against an external
  `(localStorage + matchMedia)` store — no `setState`-in-effect.

### Color tokens

- **Pastel UI chrome** (`--primary`, `--secondary`, `--accent-*`, `--block-*`)
  for surfaces, KPI tiles, pills, buttons.
- **Pastel chart palette** (`--chart-1..8` — lilac, peach, baby-blue, mint,
  apricot, coral, soft-pink, butter) for chart data marks: bars, pie slices,
  stacked areas, swatches. Category separation comes from the signature
  **thick dark borders** on segments/bars, not from saturated color — every
  series is also labelled in the legend/tooltip, so meaning is never color-only.
- **Vibrant `--series-*`** is kept only for KPI **sparklines**, where a single
  accent line reads best saturated.
- **Never hardcode hex colors in components** — use the CSS variables.
- **Model → color mapping** is stable by sorted model name (`buildColorMap` in
  `lib/palette.ts`), so the same model always gets the same color across charts.

### Typography

A rounded system font stack (`"SF Pro Rounded", "Nunito", "Segoe UI Rounded",
ui-rounded, system-ui, …`) approximates Nunito's friendly feel **without any
external font request** (a hard project constraint). Nunito renders if you have
it locally; otherwise SF Pro Rounded on macOS.

### Formatting

`lib/format.ts` holds all display formatters (`formatTokens`, `formatCost`,
`formatDuration`, `formatDate`, `formatFullTokens`). Reuse them rather than
re-implementing. Tabular figures (`.tabular` / `.num`) are used for all data
columns, KPIs, and tooltips to prevent layout shift.

---

## Configuration

### `CLAUDE_DIR` / `CODEX_DIR` / `ANTIGRAVITY_DIR` override

Set `CLAUDE_DIR=/path/to/.claude`, `CODEX_DIR=/path/to/.codex`, or
`ANTIGRAVITY_DIR=/path/to/.gemini/antigravity-ide` to point at an alternate
config directory (e.g. for testing, or a non-default install path). Each
adapter reads its own env var; it flows into every file lookup.

```bash
CLAUDE_DIR=/tmp/fake-claude pnpm dev
CODEX_DIR=/tmp/fake-codex pnpm dev
ANTIGRAVITY_DIR=/tmp/fake-anti pnpm dev
```

Each adapter owns its own env override.

### No other configuration

There is no `.env`, no config file, no auth, no database. The only inputs are
the session transcripts under your agents' data directories.

## Demo deployment (Vercel)

The dashboard reads from the filesystem, so a real deploy shows your own data
only if you point `CLAUDE_DIR` / `CODEX_DIR` / `ANTIGRAVITY_DIR` at directories
present on the host. For a public **demo deploy** (e.g. on Vercel), sample
transcripts are committed under `demo-data/` and regenerated by:

```bash
node scripts/generate-fake-data.mjs    # writes ~40 Claude sessions + ~25 Codex rollouts + ~20 Antigravity transcripts over 30 days
```

This produces three parallel trees that match the adapters' on-disk shapes:

- `demo-data/projects/<slug>/<id>.jsonl` — fake Claude Code sessions
- `demo-data/codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `demo-data/codex/session_index.jsonl` — fake Codex rollouts
- `demo-data/antigravity/brain/<uuid>/.system_generated/logs/transcript_full.jsonl` — fake Antigravity transcripts (activity-only)

To deploy the demo on Vercel:

1. Push the repo (the `demo-data/` directory and `next.config.ts`'s
   `outputFileTracingIncludes` ensure the JSONL ships in the serverless bundle —
   Next's file tracer can't see files read via `readdir` at runtime, so they're
   included explicitly, including the `.system_generated/logs` dot-dirs).
2. Set these env vars in the Vercel project settings (resolved against the
   project root, which is the runtime cwd):
   - **`CLAUDE_DIR=./demo-data`** (→ `./demo-data/projects`)
   - **`CODEX_DIR=./demo-data/codex`** (→ `./demo-data/codex/sessions` + index)
   - **`ANTIGRAVITY_DIR=./demo-data/antigravity`** (→ `./demo-data/antigravity/brain`)
3. Deploy. The dashboard renders the fake data across every panel — the
   overview shows all three agents' cards plus combined token/cost panels
   (Claude + Codex) and activity contributions (Antigravity), and `/claude`,
   `/codex`, `/antigravity` show each agent scoped.

For a deploy backed by your **real** data, copy your `~/.claude/projects/`,
`~/.codex/`, and `~/.gemini/antigravity-ide/brain/` trees into the repo (or a
private sibling) and point the env vars at them the same way — but note that
exposes your real usage transcripts to anyone who can read the deploy.

---

## Notes & constraints

- **Local only.** No database, no auth, no external requests — including no
  external font requests. Don't add any.
- **Live reads.** Both the page and API route are `force-dynamic`. Don't cache
  them.
- **Next.js 16.** APIs and conventions may differ from older Next versions —
  read `node_modules/next/dist/docs/` before touching Next APIs, and heed
  deprecation notices.
- **Tailwind v4.** `@import "tailwindcss"` in `app/globals.css`; there is no
  `tailwind.config`. Use CSS variables for design tokens, not a config file.
- **Project names** come from `humanizeProjectSlug` inside the Claude adapter,
  which strips the `-Users-...-Projects-` prefix of Claude Code's session-dir
  slugs. Adjust the markers there if slugs change shape. (Each adapter
  humanizes its own tool's slugs.)

---

## License

Private / personal-use. No license granted for redistribution.