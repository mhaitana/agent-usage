# AGENTS.md

Local dashboard that reads Claude Code usage data live from `~/.claude/projects/*`.

## Stack
- Next.js 16 (App Router) + TypeScript, pnpm.
- Tailwind v4 (`@import "tailwindcss"` in `app/globals.css`; no config file).
- Recharts 3 for charts.

## Commands
```bash
pnpm dev          # start dev server (http://localhost:3000)
pnpm build        # production build
pnpm type-check   # tsc --noEmit
pnpm lint         # next lint
```

## Conventions
- This is a Next.js 16 project. APIs/conventions may differ from your training
  data — read `node_modules/next/dist/docs/` before touching Next APIs.
- Server components read `~/.claude` directly via `lib/claude-data.ts`; the page
  and API route are `force-dynamic` so data is always live.
- Charts use CSS color variables defined in `app/globals.css` (dataviz skill
  palette), so they switch light/dark automatically.
- Cost is an API-price equivalent (see `lib/pricing.ts`), not a subscription bill.

## Data path override
Set `CLAUDE_DIR=/path/to/.claude` to point at an alternate Claude Code config dir.