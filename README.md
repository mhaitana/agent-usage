# Agent Usage Dashboard

A local-only Next.js dashboard that reads **coding-agent usage data live** from
your machine and renders token, cost, session, and project analytics. No
database, no auth, no external requests — everything runs against your own
session transcripts.

Today it reads **Claude Code** (`~/.claude/projects/*/*.jsonl`). The architecture
is built around an **adapter seam** so that adding Codex, Antigravity, or
another agent later is a new file, not a refactor — see
[Adding a new agent](#adding-a-new-agent).

![Stack](https://img.shields.io/badge/Next.js-16.2-black) ![React](https://img.shields.io/badge/React-19-149eca) ![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8) ![Recharts](https://img.shields.io/badge/Recharts-3-22c55e)

---

## What it shows

A single-page dashboard built from your agent session logs:

| Panel | What it renders |
|---|---|
| **KPI tiles** | Total tokens, est. cost, sessions, tool calls, cache-read tokens, active window — each with a sparkline trend. |
| **Daily tokens** | Stacked area chart of tokens per day, split by model. Click a legend item to toggle a model on/off. |
| **By model** | Donut of each model's share of total tokens, with a per-model share bar, token count, and API-price-equivalent cost. |
| **By project** | Horizontal bar chart of the top 12 projects by token volume, with cost and session counts. |
| **Sessions** | Sortable, filterable table of every session — last seen, project, title, models, messages, tool calls, tokens, cost, duration. |

All numbers are computed live from the transcripts on every request — nothing
is cached to disk, nothing leaves your machine.

---

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

That's it. The app reads `~/.claude/projects/*/*.jsonl` from your machine and
renders the dashboard. If you've used Claude Code in this directory tree, you'll
see data immediately.

### Prerequisites

- Node.js 20+ (Node 24 is used in development)
- pnpm 10+ (`corepack enable` if you don't have it)
- Existing Claude Code session transcripts under `~/.claude/projects/`

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
~/.claude/projects/*/*.jsonl          (Codex → ~/.codex/sessions/…, etc.)
        │
        ▼
lib/adapters/claude.ts   claudeAdapter              ← Claude-specific extraction
   (DiscoveredSession[] → Session[])                 + Anthropic pricing
        │
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

### In-memory mtime cache

Each parsed session is cached keyed by `path + mtime + size`, so re-rendering
is cheap until a session file actually changes. This is a **process-local**
cache — there is no disk-backed state, intentionally. Don't introduce any.

### Daily attribution

Each session's tokens are bucketed onto the **day of its `lastSeen`** — a
session lands on one day, not spread across its duration. Preserve this if you
touch the daily chart math.

### Cost is API-price-equivalent, not your bill

`lib/pricing.ts` estimates cost from public Anthropic API list prices. Claude
Code subscriptions (Pro / Max) are **not** pay-per-token — these numbers are a
rough gauge of value/volume, not what you're actually charged. `rateFor()`
resolves model ids by **exact match → prefix match → family heuristic**
(`haiku` / `opus` / `sonnet` / `fable`). When Anthropic pricing changes, add
new rates to `RATES`; update `DEFAULT_RATE` last.

> `lib/pricing.ts` is currently Anthropic-specific. When a second vendor lands,
> split it into `lib/pricing/{anthropic,openai,…}.ts` and have each adapter
> import its own.

---

## Project structure

```
app/
  layout.tsx          root layout + no-FOUC theme boot script
  page.tsx            the dashboard page (single page)
  globals.css         design tokens + claymorphism × neo-brutalism styles
  api/usage/route.ts  JSON API → UsageDataset
components/
  DashboardHeader.tsx  title, live indicator, refresh, theme switcher
  KpiTiles.tsx         pastel block KPI tiles + sparklines
  DailyChart.tsx       stacked area chart by model
  ModelBreakdown.tsx   donut + per-model share bars
  ProjectBreakdown.tsx horizontal bar chart
  SessionTable.tsx     sortable/filterable sessions table
  ThemeSwitcher.tsx    System / Light / Dark switcher
  ui/                  Card, icons, Sparkline primitives
lib/
  adapters/
    types.ts        Adapter, DiscoveredSession interfaces
    claude.ts       Claude Code adapter (JSONL, paths, slug humanizing, cost)
  usage-data.ts     orchestrator: registry, mtime cache, aggregation
  format.ts         display formatters (formatTokens, formatCost, …)
  palette.ts        model → color mapping (chart series)
  pricing.ts        Anthropic API-price-equivalent cost (Claude adapter imports)
  types.ts          shared types (UsageDataset, Session, AdapterStatus, …)
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
   - `name` — display name ("Codex").
   - `isAvailable()` — `stat` the tool's data dir; return false if missing.
   - `discoverSessions()` — walk the tool's data dir and return
     `DiscoveredSession[]` (`{ key, path, projectSlug }`).
   - `parseSession(d)` — read `d.path`, map the tool's raw records onto the
     normalized `Session` shape (zeros for token fields it doesn't expose),
     compute cost via its vendor pricing.
2. **Add pricing** — for a new vendor, create `lib/pricing/<vendor>.ts` with a
   `costOf(...)` matching the Anthropic one. (When you do, rename the existing
   `lib/pricing.ts` → `lib/pricing/anthropic.ts` for symmetry.)
3. **Register it** — add the adapter to `ADAPTERS` in `lib/usage-data.ts`.
4. **Env override** — if the tool's data dir is configurable, read its env var
   inside the adapter (e.g. `CODEX_DIR`), mirroring the `CLAUDE_DIR` pattern.

No other files should need to change — the orchestrator, cache, aggregation,
and all components stay as-is. The new tool's sessions merge into the existing
`UsageDataset` and appear across every panel.

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

### `CLAUDE_DIR` override

Set `CLAUDE_DIR=/path/to/.claude` to point at an alternate Claude Code config
directory (e.g. for testing, or a non-default install path). The Claude adapter
reads it; it flows into every file lookup.

```bash
CLAUDE_DIR=/tmp/fake-claude pnpm dev
```

Each adapter owns its own env override (this is the pattern a future `CODEX_DIR`
or `ANTIGRAVITY_DIR` would follow).

### No other configuration

There is no `.env`, no config file, no auth, no database. The only inputs are
the session transcripts under your agents' data directories.

## Demo deployment (Vercel)

The dashboard reads from the filesystem, so a real deploy shows your own data
only if you point `CLAUDE_DIR` at a directory present on the host. For a public
**demo deploy** (e.g. on Vercel), sample transcripts are committed under
`demo-data/projects/*/*.jsonl` and regenerated by:

```bash
node scripts/generate-fake-data.mjs    # writes ~40 fake sessions over 30 days
```

To deploy the demo on Vercel:

1. Push the repo (the `demo-data/` directory and `next.config.ts`'s
   `outputFileTracingIncludes` ensure the JSONL ships in the serverless bundle —
   Next's file tracer can't see files read via `readdir` at runtime, so they're
   included explicitly).
2. Set the env var **`CLAUDE_DIR=./demo-data`** in the Vercel project settings
   (resolved against the project root, which is the runtime cwd).
3. Deploy. The dashboard renders the fake data across every panel.

For a deploy backed by your **real** Claude Code data, copy your
`~/.claude/projects/` tree into the repo (or a private sibling) and point
`CLAUDE_DIR` at it the same way — but note that exposes your real usage
transcripts to anyone who can read the deploy.

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