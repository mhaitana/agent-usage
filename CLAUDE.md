# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only Next.js dashboard that reads coding-agent usage data live from your machine and renders token/cost/session analytics. No database, no auth, no external requests. Today only Claude Code is wired up; an **adapter seam** (`lib/adapters/`) makes adding Codex / Antigravity / others a new file, not a refactor.

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

**Adapter architecture:** each coding agent sits behind an `Adapter` (`lib/adapters/types.ts`) that owns its discovery (`isAvailable` / `discoverSessions`), parsing (`parseSession`), and vendor pricing. A tool-agnostic orchestrator (`lib/usage-data.ts`) holds the adapter registry (`ADAPTERS`), a generic in-memory mtime cache, and all aggregation into `UsageDataset` (`daily`, `byModel`, `byProject`, `totals`). `getUsageDataset()` fans out across registered adapters, caches each parsed session by `path + mtime + size`, and aggregates the normalized `Session[]` they return.

The normalized `Session` shape (`lib/types.ts`) is a **superset** — it carries Anthropic's token taxonomy (input / cache-creation / cache-read / output). Future adapters map their vendor's tokens onto it, using `0` for fields they don't expose, so the shape and components stay stable when a new agent is added.

Key design points when editing:
- **Claude JSONL parsing** (`parseSessionFile` in `lib/adapters/claude.ts`): records have a `type` field. Only `assistant` and `user` contribute usage/messages; `ai-title` records supply the session title. Token fields come from `message.usage` on assistant records. Tool calls are counted by scanning `message.content` blocks for `type === "tool_use"`. Malformed lines are skipped defensively.
- **In-memory mtime cache** (`parseWithCache` in `lib/usage-data.ts`): each parsed file is cached keyed by `path + mtime + size`, so re-rendering is cheap until a session file changes. This is a process-local cache — do not introduce disk-backed state without reason. It is **adapter-agnostic** — it stores the normalized `Session` returned by whichever adapter discovered the file.
- **Daily attribution**: each session's tokens are bucketed onto the day of its `lastSeen` (a session lands on one day, not spread across its duration). Preserve this if you touch the daily chart math.
- **Cost is API-price-equivalent** (`lib/pricing.ts`), *not* a subscription bill. `rateFor()` resolves model ids by exact match → prefix match → family heuristic (`haiku`/`opus`/`sonnet`/`fable`). Add new model rates to `RATES` when Anthropic pricing changes; update the default fallback last. `lib/pricing.ts` is currently Anthropic-specific (the Claude adapter imports it); when a second vendor lands, split it into `lib/pricing/<vendor>.ts` and have each adapter import its own.
- **Colors**: chart data marks use the pastel `--chart-1..8` CSS variables (defined in `app/globals.css`); `lib/palette.ts` mirrors them for chart series. KPI sparklines keep the vibrant `--series-*` set. Model→color mapping is stable by sorted model name (`buildColorMap`). Theme switching is via `data-theme` on `<html>` (resolved by a boot script, not a CSS media query). Do not hardcode hex colors in components — use the vars.
- **Project names**: each adapter humanizes its own tool's slugs. The Claude adapter's `humanizeProjectSlug` strips the `-Users-...-Projects-` prefix of Claude Code's session-dir slugs — adjust the markers there if slugs change shape.
- `lib/format.ts` holds all display formatters (`formatTokens`, `formatCost`, `formatDuration`, `formatDate`). Reuse them rather than re-implementing.

Components are presentational and receive pre-aggregated slices of `UsageDataset`:

| Component | Input |
|---|---|
| `KpiTiles` | `totals` + `daily` |
| `DailyChart` | `daily[]` (stacked by model) |
| `ModelBreakdown` | `byModel[]` |
| `ProjectBreakdown` | `byProject[]` |
| `SessionTable` | `sessions[]` |

## Adding a new agent

1. Create `lib/adapters/<tool>.ts` implementing `Adapter` from `lib/adapters/types.ts` (`name`, `isAvailable`, `discoverSessions`, `parseSession` → normalized `Session`).
2. Add vendor pricing (new file under `lib/pricing/` if a new vendor; rename existing `lib/pricing.ts` → `lib/pricing/anthropic.ts` for symmetry).
3. Register the adapter in `ADAPTERS` (`lib/usage-data.ts`).
4. Read the tool's data-dir env override inside the adapter (mirrors `CLAUDE_DIR`).

No other files should need to change — orchestrator, cache, aggregation, and all components stay as-is.

## Data path override

Set `CLAUDE_DIR=/path/to/.claude` to point at an alternate Claude Code config dir (e.g. for testing). The Claude adapter reads it; it flows into every file lookup. Each adapter owns its own env override (the pattern a future `CODEX_DIR` / `ANTIGRAVITY_DIR` would follow).