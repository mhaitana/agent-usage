// Generate realistic fake coding-agent session transcripts for demo deploys
// (e.g. Vercel). Writes:
//   - Claude Code sessions  → demo-data/projects/<slug>/<id>.jsonl
//   - Codex rollouts        → demo-data/codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//     plus demo-data/codex/session_index.jsonl (id → thread_name index)
//   - Antigravity transcripts → demo-data/antigravity/brain/<uuid>/.system_generated/logs/transcript_full.jsonl
//
// All three match the on-disk shapes the adapters read. Run:
//
//   node scripts/generate-fake-data.mjs
//
// Then deploy with:
//   CLAUDE_DIR=./demo-data            (→ ./demo-data/projects)
//   CODEX_DIR=./demo-data/codex       (→ ./demo-data/codex/sessions + index)
//   ANTIGRAVITY_DIR=./demo-data/antigravity  (→ ./demo-data/antigravity/brain)
//
// (relative to the project root, which is the runtime cwd on Vercel). Re-run
// any time to regenerate / expand.
//
// This is a one-off local generator, so Math.random / new Date() are fine here
// (they are forbidden inside the workflow runtime, not in scripts).

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "demo-data");
const CODEX_OUT = join(OUT, "codex");
const ANTI_OUT = join(OUT, "antigravity");

const CLAUDE_MODELS = [
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
];

const CODEX_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5-mini"];

const ANTIGRAVITY_MODELS = ["Gemini 3.5 Flash", "Gemini 3.1 Pro", "Gemini 3 Flash"];

// Shared project set — same cwds for both tools so the overview's by-project
// view shows them merged (one person, two tools, same repos).
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

const CLAUDE_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "TodoWrite"];
const CODEX_TOOLS = ["shell", "apply_patch", "read_file", "grep", "list_dir"];
const ANTIGRAVITY_TOOLS = ["view_file", "edit_file", "grep_search", "run_command", "list_directory", "search_web"];

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

// UUID-ish string (deterministic from seed) — Codex session ids look like
// 019f2568-b495-7970-b960-5e58b4944564.
function uuidFrom(seed) {
  const a = idFrom(seed + "a");
  const b = idFrom(seed + "b").slice(0, 4);
  const c = idFrom(seed + "c").slice(0, 4);
  const d = idFrom(seed + "d").slice(0, 4);
  const e = idFrom(seed + "e").padStart(12, "0");
  return `${a}-${b}-${c}-${d}-${e}`;
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

function makeClaudeSession({ project, dayOffset, idx }) {
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
  const primaryModel = pick(CLAUDE_MODELS);
  const turns = rand(6, 28);
  const stepMs = (end.getTime() - start.getTime()) / turns;
  for (let t = 0; t < turns; t++) {
    const cursor = new Date(start.getTime() + stepMs * t);
    // user turn
    lines.push({
      type: "user",
      sessionId,
      timestamp: isoDate(cursor),
      cwd,
      message: { role: "user", content: [{ type: "text", text: `turn ${t + 1}` }] },
    });
    // assistant turn
    const model = Math.random() < 0.85 ? primaryModel : pick(CLAUDE_MODELS);
    const isBigModel = model.includes("opus");
    const inputTokens = rand(isBigModel ? 20_000 : 4_000, isBigModel ? 180_000 : 40_000);
    const cacheReadTokens = Math.random() < 0.6 ? rand(5_000, 120_000) : 0;
    const cacheCreationTokens = Math.random() < 0.4 ? rand(2_000, 30_000) : 0;
    const outputTokens = rand(200, isBigModel ? 8_000 : 3_000);
    const toolUseCount = rand(0, 4);
    const content = [{ type: "text", text: "ok" }];
    for (let u = 0; u < toolUseCount; u++) {
      content.push({ type: "tool_use", id: `toolu_${idFrom(sessionId + t + u)}`, name: pick(CLAUDE_TOOLS), input: {} });
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

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

function makeCodexSession({ project, dayOffset, idx }) {
  const sessionId = uuidFrom(`codex-${project.slug}-${dayOffset}-${idx}`);
  const start = new Date();
  start.setDate(start.getDate() - dayOffset);
  start.setHours(rand(8, 22), rand(0, 59), 0, 0);
  const durationMin = rand(5, 120);
  const end = new Date(start.getTime() + durationMin * 60_000);

  const title = `${project.titlePrefix}: ${pick(TITLE_FRAGMENTS)}`;
  const cwd = project.cwd;
  const lines = [];

  // session_meta — newer Codex emits both `id` and `session_id`.
  lines.push({
    type: "session_meta",
    timestamp: isoDate(start),
    payload: {
      id: sessionId,
      session_id: sessionId,
      timestamp: isoDate(start),
      cwd,
      originator: "codex_cli",
      cli_version: "0.142.0-alpha.1",
      source: "cli",
      thread_source: "user",
      model_provider: "openai",
    },
  });

  const primaryModel = pick(CODEX_MODELS);
  const turns = rand(4, 18);
  const stepMs = (end.getTime() - start.getTime()) / turns;

  // Cumulative totals for realism (the adapter only reads last_token_usage).
  let cumIn = 0, cumCached = 0, cumOut = 0;

  for (let t = 0; t < turns; t++) {
    const ts = new Date(start.getTime() + stepMs * t);
    const model = Math.random() < 0.85 ? primaryModel : pick(CODEX_MODELS);

    // turn_context precedes this turn's token_count — the adapter attributes
    // the upcoming token delta to this model.
    lines.push({
      type: "turn_context",
      timestamp: isoDate(ts),
      payload: { model, input_history: [], tools: [] },
    });

    // user message
    lines.push({
      type: "event_msg",
      timestamp: isoDate(ts),
      payload: { type: "user_message", message: `turn ${t + 1}`, role: "user" },
    });

    // tool calls (response_item)
    const toolCount = rand(0, 3);
    for (let u = 0; u < toolCount; u++) {
      const isFn = Math.random() < 0.3;
      lines.push({
        type: "response_item",
        timestamp: isoDate(new Date(ts.getTime() + rand(1, 8) * 1000)),
        payload: isFn
          ? { type: "function_call", name: pick(CODEX_TOOLS), call_id: `call_${idFrom(sessionId + t + u)}`, arguments: "{}" }
          : { type: "custom_tool_call", name: pick(CODEX_TOOLS), call_id: `call_${idFrom(sessionId + t + u)}`, args: "{}" },
      });
    }

    // agent message
    lines.push({
      type: "event_msg",
      timestamp: isoDate(new Date(ts.getTime() + rand(2, 15) * 1000)),
      payload: { type: "agent_message", message: "ok" },
    });

    // token_count — last_token_usage is a per-response DELTA; total_token_usage
    // is cumulative. input_tokens includes cached_input_tokens.
    const cached = Math.random() < 0.7 ? rand(5_000, 120_000) : 0;
    const nonCached = rand(2_000, 40_000);
    const inputTokens = nonCached + cached;
    const outputTokens = rand(200, 4_000);
    const reasoning = rand(0, Math.floor(outputTokens * 0.6));
    cumIn += inputTokens;
    cumCached += cached;
    cumOut += outputTokens;
    lines.push({
      type: "event_msg",
      timestamp: isoDate(new Date(ts.getTime() + rand(3, 20) * 1000)),
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: cached,
            output_tokens: outputTokens,
            reasoning_output_tokens: reasoning,
            total_tokens: inputTokens + outputTokens,
          },
          total_token_usage: {
            input_tokens: cumIn,
            cached_input_tokens: cumCached,
            output_tokens: cumOut,
            reasoning_output_tokens: 0,
            total_tokens: cumIn + cumOut,
          },
        },
      },
    });
  }

  return { sessionId, title, cwd, start, end, lines };
}

// ---------------------------------------------------------------------------
// Antigravity (activity-only — no token data on disk)
// ---------------------------------------------------------------------------

function makeAntigravitySession({ project, dayOffset, idx }) {
  const sessionId = uuidFrom(`anti-${project.slug}-${dayOffset}-${idx}`);
  const start = new Date();
  start.setDate(start.getDate() - dayOffset);
  start.setHours(rand(8, 22), rand(0, 59), 0, 0);
  const durationMin = rand(4, 90);
  const end = new Date(start.getTime() + durationMin * 60_000);

  const title = `${project.titlePrefix}: ${pick(TITLE_FRAGMENTS)}`;
  const cwd = project.cwd;
  const model = pick(ANTIGRAVITY_MODELS);
  const tier = pick(["High", "Medium", "Low"]);
  const lines = [];
  let step = 0;
  function rec(r) { lines.push({ step_index: step++, ...r }); }

  // Initial USER_INPUT: model selection (from None → model) + the user request
  // + active document metadata. The adapter reads the model from <USER_SETTINGS_CHANGE>
  // and the title from <USER_REQUEST>, and the cwd from Active Document.
  rec({
    source: "user",
    type: "USER_INPUT",
    status: "COMPLETED",
    created_at: isoDate(start),
    content: [
      `<USER_REQUEST>${title}</USER_REQUEST>`,
      `<ADDITIONAL_METADATA>Active Document: ${cwd}/src/main.ts</ADDITIONAL_METADATA>`,
      `<USER_SETTINGS_CHANGE>Model changed from None to ${model} (${tier}). Reason: user selection.</USER_SETTINGS_CHANGE>`,
    ].join("\n"),
  });

  const turns = rand(3, 12);
  const stepMs = (end.getTime() - start.getTime()) / turns;
  for (let t = 0; t < turns; t++) {
    const ts = new Date(start.getTime() + stepMs * t);
    // Planner response with explicit tool_calls[].
    const toolCount = rand(1, 4);
    const toolCalls = [];
    for (let u = 0; u < toolCount; u++) {
      toolCalls.push({ name: pick(ANTIGRAVITY_TOOLS), args: { query: "demo", path: `${cwd}/src` } });
    }
    rec({
      source: "planner",
      type: "PLANNER_RESPONSE",
      status: "COMPLETED",
      created_at: isoDate(ts),
      content: `Planning step ${t + 1}`,
      tool_calls: toolCalls,
    });

    // A RUN_COMMAND carrying the CWD: line (authoritative cwd source).
    rec({
      source: "executor",
      type: "RUN_COMMAND",
      status: "COMPLETED",
      created_at: isoDate(new Date(ts.getTime() + rand(1, 8) * 1000)),
      content: `CWD: ${cwd}\n$ pnpm test`,
    });

    // A couple of tool-exec records without tool_calls[] (counted as tool calls).
    if (Math.random() < 0.7) {
      rec({
        source: "executor",
        type: "VIEW_FILE",
        status: "COMPLETED",
        created_at: isoDate(new Date(ts.getTime() + rand(2, 10) * 1000)),
        content: `Viewed ${cwd}/src/main.ts`,
      });
    }
    if (Math.random() < 0.5) {
      rec({
        source: "executor",
        type: "CODE_ACTION",
        status: "COMPLETED",
        created_at: isoDate(new Date(ts.getTime() + rand(3, 12) * 1000)),
        content: `Edited ${cwd}/src/main.ts`,
      });
    }

    // Follow-up user message.
    rec({
      source: "user",
      type: "USER_INPUT",
      status: "COMPLETED",
      created_at: isoDate(new Date(ts.getTime() + rand(4, 15) * 1000)),
      content: `<USER_REQUEST>turn ${t + 1} follow-up</USER_REQUEST>`,
    });
  }

  // Closing system message.
  rec({
    source: "system",
    type: "SYSTEM_MESSAGE",
    status: "COMPLETED",
    created_at: isoDate(end),
    content: "Session complete.",
  });

  return { sessionId, title, cwd, start, end, lines };
}

// ---------------------------------------------------------------------------

async function main() {
  await rm(OUT, { recursive: true, force: true });
  let claudeCount = 0;
  let codexCount = 0;
  let antiCount = 0;
  const codexIndex = [];

  for (const project of PROJECTS) {
    // Claude
    const claudePer = rand(6, 12);
    for (let i = 0; i < claudePer; i++) {
      const dayOffset = rand(0, 29);
      const { sessionId, slug, lines } = makeClaudeSession({ project, dayOffset, idx: i });
      const dir = join(OUT, "projects", slug);
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${sessionId}.jsonl`);
      const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      await writeFile(file, body, "utf8");
      claudeCount++;
    }

    // Codex
    const codexPer = rand(3, 7);
    for (let i = 0; i < codexPer; i++) {
      const dayOffset = rand(0, 29);
      const s = makeCodexSession({ project, dayOffset, idx: i });
      const d = s.start;
      const dir = join(
        CODEX_OUT,
        "sessions",
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      );
      await mkdir(dir, { recursive: true });
      const stamp = isoDate(d).replace(/[:.]/g, "-");
      const file = join(dir, `rollout-${stamp}-${s.sessionId}.jsonl`);
      const body = s.lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      await writeFile(file, body, "utf8");
      codexIndex.push({ id: s.sessionId, thread_name: s.title, updated_at: isoDate(s.end) });
      codexCount++;
    }

    // Antigravity — activity-only (no token data on disk)
    const antiPer = rand(3, 6);
    for (let i = 0; i < antiPer; i++) {
      const dayOffset = rand(0, 29);
      const s = makeAntigravitySession({ project, dayOffset, idx: i });
      const dir = join(ANTI_OUT, "brain", s.sessionId, ".system_generated", "logs");
      await mkdir(dir, { recursive: true });
      const file = join(dir, "transcript_full.jsonl");
      const body = s.lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      await writeFile(file, body, "utf8");
      antiCount++;
    }
  }

  // Codex title index
  const indexDir = dirname(join(CODEX_OUT, "session_index.jsonl"));
  await mkdir(indexDir, { recursive: true });
  const indexBody = codexIndex.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(join(CODEX_OUT, "session_index.jsonl"), indexBody, "utf8");

  console.log(
    `Wrote ${claudeCount} Claude sessions to ${join(OUT, "projects")}, ${codexCount} Codex rollouts (+ index) to ${CODEX_OUT}, and ${antiCount} Antigravity transcripts to ${ANTI_OUT}`,
  );
}

await main();