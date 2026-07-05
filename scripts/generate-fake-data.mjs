// Generate realistic fake Claude Code session transcripts for demo deploys
// (e.g. Vercel). Writes JSONL files under <root>/demo-data/projects/<slug>/
// matching the on-disk shape the Claude adapter reads. Run:
//
//   node scripts/generate-fake-data.mjs
//
// Then deploy with CLAUDE_DIR=./demo-data (relative to the project root, which
// is the runtime cwd on Vercel). Re-run any time to regenerate / expand.
//
// This is a one-off local generator, so Math.random / new Date() are fine here
// (they are forbidden inside the workflow runtime, not in scripts).

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "demo-data");

const MODELS = [
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
];

const PROJECTS = [
  { slug: "-Users-demo-Projects-webapp", cwd: "/Users/demo/Projects/webapp", titlePrefix: "webapp" },
  { slug: "-Users-demo-Projects-api", cwd: "/Users/demo/Projects/api", titlePrefix: "api" },
  { slug: "-Users-demo-Projects-mobile", cwd: "/Users/demo/Projects/mobile", titlePrefix: "mobile" },
  { slug: "-Users-demo-Projects-ml-pipeline", cwd: "/Users/demo/Projects/ml-pipeline", titlePrefix: "ml-pipeline" },
  { slug: "-Users-demo-Projects-docs-site", cwd: "/Users/demo/Projects/docs-site", titlePrefix: "docs-site" },
];

const TITLE_FRAGMENTS = [
  "refactor auth flow", "fix layout shift on mobile", "add pagination to sessions table",
  "wire up theme switcher", "optimize jsonl parser", "migrate to tailwind v4",
  "add cost estimation", "debug recharts tooltip", "scaffold api route",
  "implement adapter seam", "tune pastel chart palette", "fix ssr hydration mismatch",
  "add codex adapter", "rewrite daily attribution", "split pricing by vendor",
  "add empty states", "tune kpi sparkline", "add session search",
];

const TOOL_NAMES = ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "TodoWrite"];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function isoDate(d) { return d.toISOString(); }

// deterministic-ish id from a seed string
function idFrom(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function makeSession({ project, dayOffset, idx }) {
  const sessionId = idFrom(`${project.slug}-${dayOffset}-${idx}`) + "-fake-0000-0000-000000000000";
  const start = new Date();
  start.setDate(start.getDate() - dayOffset);
  start.setHours(rand(8, 22), rand(0, 59), 0, 0);
  const durationMin = rand(8, 180);
  const end = new Date(start.getTime() + durationMin * 60_000);

  const title = `${project.titlePrefix}: ${pick(TITLE_FRAGMENTS)}`;
  const cwd = project.cwd;
  const lines = [];

  // ai-title record
  lines.push({
    type: "ai-title",
    sessionId,
    aiTitle: title,
    timestamp: isoDate(start),
    cwd,
  });

  // alternate user / assistant turns; one model per session (mostly), with
  // occasional model switches for variety in the by-model breakdown.
  const primaryModel = pick(MODELS);
  const turns = rand(6, 28);
  let cursor = new Date(start.getTime());
  const stepMs = (end.getTime() - start.getTime()) / turns;
  for (let t = 0; t < turns; t++) {
    cursor = new Date(start.getTime() + stepMs * t);
    // user turn
    lines.push({
      type: "user",
      sessionId,
      timestamp: isoDate(cursor),
      cwd,
      message: { role: "user", content: [{ type: "text", text: `turn ${t + 1}` }] },
    });
    // assistant turn
    const model = Math.random() < 0.85 ? primaryModel : pick(MODELS);
    const isBigModel = model.includes("opus");
    const inputTokens = rand(isBigModel ? 20_000 : 4_000, isBigModel ? 180_000 : 40_000);
    const cacheReadTokens = Math.random() < 0.6 ? rand(5_000, 120_000) : 0;
    const cacheCreationTokens = Math.random() < 0.4 ? rand(2_000, 30_000) : 0;
    const outputTokens = rand(200, isBigModel ? 8_000 : 3_000);
    const toolUseCount = rand(0, 4);
    const content = [{ type: "text", text: "ok" }];
    for (let u = 0; u < toolUseCount; u++) {
      content.push({ type: "tool_use", id: `toolu_${idFrom(sessionId + t + u)}`, name: pick(TOOL_NAMES), input: {} });
    }
    lines.push({
      type: "assistant",
      sessionId,
      timestamp: isoDate(new Date(cursor.getTime() + rand(1, 20) * 1000)),
      cwd,
      message: {
        role: "assistant",
        model,
        usage: {
          input_tokens: inputTokens,
          cache_creation_input_tokens: cacheCreationTokens,
          cache_read_input_tokens: cacheReadTokens,
          output_tokens: outputTokens,
        },
        content,
      },
    });
  }

  return { sessionId, slug: project.slug, lines };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  let count = 0;
  for (const project of PROJECTS) {
    const sessionsPerProject = rand(6, 12);
    for (let i = 0; i < sessionsPerProject; i++) {
      const dayOffset = rand(0, 29); // last 30 days
      const { sessionId, slug, lines } = makeSession({ project, dayOffset, idx: i });
      const dir = join(OUT, "projects", slug);
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${sessionId}.jsonl`);
      const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      await writeFile(file, body, "utf8");
      count++;
    }
  }
  console.log(`Wrote ${count} fake sessions to ${OUT}`);
}

await main();