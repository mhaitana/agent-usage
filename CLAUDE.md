# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only Next.js dashboard that reads Claude Code usage data live from `~/.claude/projects/*/*.jsonl` and renders token/cost/session analytics. No database, no auth, no external requests.

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

The whole app is a single page (`app/page.tsx`) plus one JSON API route (`app/api/usage/route.ts`). Both are `force-dynamic` — data is always read live, never cached.

**Data flow:** `lib/claude-data.ts` is the core. `getUsageDataset()` walks `projectsDir()` (from `lib/paths.ts`), streams each session `.jsonl` line-by-line, accumulates per-session token totals keyed by model, then aggregates into `daily`, `byModel`, `byProject`, and `totals` views (shape defined in `lib/types.ts`).

Key design points when editing:
- **JSONL parsing** (`parseSessionFile`): records have a `type` field. Only `assistant` and `user` contribute usage/messages; `ai-title` records supply the session title. Token fields come from `message.usage` on assistant records. Tool calls are counted by scanning `message.content` blocks for `type === "tool_use"`. Malformed lines are skipped defensively.
- **In-memory mtime cache** (`parseWithCache`): each parsed file is cached keyed by mtime+size, so re-rendering is cheap until a session file changes. This is a process-local cache — do not introduce disk-backed state without reason.
- **Daily attribution**: each session's tokens are bucketed onto the day of its `lastSeen` (a session lands on one day, not spread across its duration). Preserve this if you touch the daily chart math.
- **Cost is API-price-equivalent** (`lib/pricing.ts`), *not* a subscription bill. `rateFor()` resolves model ids by exact match → prefix match → family heuristic (`haiku`/`opus`/`sonnet`/`fable`). Add new model rates to `RATES` when Anthropic pricing changes; update the default fallback last.
- **Colors**: charts use CSS variables (`--series-1..8`) defined in `app/globals.css` (the dataviz skill's CVD-safe palette). `lib/palette.ts` mirrors them for chart series. Model→color mapping is stable by sorted model name (`buildColorMap`). Theme switching is automatic via `prefers-color-scheme`. Do not hardcode hex colors in components — use the vars.
- **Project names** come from `humanizeProjectSlug` (`lib/format.ts`), which strips the `-Users-...-Projects-` prefix of Claude Code's session-dir slugs. Adjust the markers there if slugs change shape.
- `lib/format.ts` holds all display formatters (`formatTokens`, `formatCost`, `formatDuration`, `formatDate`). Reuse them rather than re-implementing.

Components are presentational and receive pre-aggregated slices of `UsageDataset`:

| Component | Input |
|---|---|
| `KpiTiles` | `totals` |
| `DailyChart` | `daily[]` (stacked by model) |
| `ModelBreakdown` | `byModel[]` |
| `ProjectBreakdown` | `byProject[]` |
| `SessionTable` | `sessions[]` |

## Data path override

Set `CLAUDE_DIR=/path/to/.claude` to point at an alternate Claude Code config dir (e.g. for testing). `lib/paths.ts` reads this; it flows into every file lookup.