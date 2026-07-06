// Generate realistic fake coding-agent session transcripts for demo deploys
// (e.g. Vercel). Writes:
//   - Claude Code sessions  → demo-data/projects/<slug>/<id>.jsonl
//   - Codex rollouts        → demo-data/codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//     plus demo-data/codex/session_index.jsonl (id → thread_name index)
//   - Antigravity transcripts → demo-data/antigravity/brain/<uuid>/.system_generated/logs/transcript_full.jsonl
//   - OpenCode sessions     → demo-data/opencode/opencode.db (SQLite: session/message/part)
//   - GitHub Copilot Chat   → demo-data/copilot/workspaceStorage/<hash>/chatSessions/<id>.jsonl
//     (+ workspace.json folder map) and demo-data/copilot/globalStorage/emptyWindowChatSessions/<id>.jsonl
//
// All five match the on-disk shapes the adapters read. Run:
//
//   node scripts/generate-fake-data.mjs
//
// Then deploy with:
//   CLAUDE_DIR=./demo-data            (→ ./demo-data/projects)
//   CODEX_DIR=./demo-data/codex       (→ ./demo-data/codex/sessions + index)
//   ANTIGRAVITY_DIR=./demo-data/antigravity  (→ ./demo-data/antigravity/brain)
//   OPENCODE_DIR=./demo-data/opencode  (→ ./demo-data/opencode/opencode.db)
//   COPILOT_DIR=./demo-data/copilot    (→ ./demo-data/copilot/workspaceStorage + globalStorage)
//
// (relative to the project root, which is the runtime cwd on Vercel). Re-run
// any time to regenerate / expand.
//
// This is a one-off local generator, so Math.random / new Date() are fine here
// (they are forbidden inside the workflow runtime, not in scripts).

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "demo-data");
const CODEX_OUT = join(OUT, "codex");
const ANTI_OUT = join(OUT, "antigravity");
const OPENCODE_OUT = join(OUT, "opencode");
const COPILOT_OUT = join(OUT, "copilot");

const CLAUDE_MODELS = [
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
];

const CODEX_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5-mini"];

const ANTIGRAVITY_MODELS = ["Gemini 3.5 Flash", "Gemini 3.1 Pro", "Gemini 3 Flash"];

// OpenCode is provider-agnostic — mix Anthropic-style, OpenAI-style, and
// proxy-routed model ids to exercise the pricing fallback (claude-* and gpt-*
// resolve via the vendor modules; glm/kimi fall back to an honest $0).
const OPENCODE_MODELS = [
  { id: "claude-sonnet-5", providerID: "anthropic" },
  { id: "gpt-4.1", providerID: "openai" },
  { id: "glm-5.2", providerID: "ollama-cloud" },
  { id: "kimi-k2.7-code", providerID: "ollama-cloud" },
];

// GitHub Copilot Chat is multi-vendor: a single chat can route to Anthropic,
// OpenAI, Google, or a local OLLAMA gateway. Copilot prefixes most model ids
// with `copilot/`; local OLLAMA ids come through unprefixed (e.g.
// `ollama/Ollama/qwen3.6:35b`) and resolve to an honest $0 via copilot.ts.
// `thinking` flags models that report separate reasoning tokens, so the demo
// exercises the adapter's `thinking.tokens` → outputTokens bundling.
const COPILOT_MODELS = [
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", multiplier: 1, thinking: false, vendor: "copilot" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", multiplier: 3, thinking: true, vendor: "copilot" },
  { id: "claude-opus-4.8", name: "Claude Opus 4.8", multiplier: 3, thinking: true, vendor: "copilot" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", multiplier: 1, thinking: false, vendor: "copilot" },
  { id: "gpt-5.5", name: "GPT-5.5", multiplier: 1, thinking: false, vendor: "copilot" },
  { id: "o4", name: "o4", multiplier: 5, thinking: true, vendor: "copilot" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", multiplier: 2, thinking: true, vendor: "copilot" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", multiplier: 1, thinking: false, vendor: "copilot" },
  { id: "ollama/Ollama/qwen3.6:35b", name: "Qwen3.6 35B (local)", multiplier: 0, thinking: false, vendor: "ollama" },
];

const COPILOT_TOOLS = ["manage_todo_list", "view_file", "edit_file", "grep_search", "run_command", "list_directory", "search_web"];

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

// 32-hex-char workspace hash (VS Code's workspaceStorage keys are 32-char hex).
function hashFrom(seed) {
  return (idFrom(seed + "x") + idFrom(seed + "y") + idFrom(seed + "z") + idFrom(seed + "w")).slice(0, 32);
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
// OpenCode (SQLite: per-session aggregates in the `session` table)
// ---------------------------------------------------------------------------

function makeOpenCodeSession({ project, dayOffset, idx }) {
  const sessionId = `ses_${uuidFrom(`opencode-${project.slug}-${dayOffset}-${idx}`)}`;
  const start = new Date();
  start.setDate(start.getDate() - dayOffset);
  start.setHours(rand(8, 22), rand(0, 59), 0, 0);
  const durationMin = rand(5, 120);
  const end = new Date(start.getTime() + durationMin * 60_000);

  const title = `${project.titlePrefix}: ${pick(TITLE_FRAGMENTS)}`;
  const cwd = project.cwd;
  const modelMeta = pick(OPENCODE_MODELS);
  const model = JSON.stringify({ id: modelMeta.id, providerID: modelMeta.providerID, variant: "default" });
  const agent = pick(["build", "plan", "general"]);

  // Realistic token volume — proxy-routed models (glm/kimi) get big input,
  // Anthropic/OpenAI get cache activity too. Cost stays 0 (OpenCode has no
  // price table for these via the proxy); the adapter recomputes for known ids.
  const isProxy = modelMeta.providerID === "ollama-cloud";
  const tokensInput = rand(isProxy ? 50_000 : 4_000, isProxy ? 4_000_000 : 200_000);
  const tokensCacheRead = isProxy ? 0 : (Math.random() < 0.6 ? rand(5_000, 120_000) : 0);
  const tokensCacheWrite = isProxy ? 0 : (Math.random() < 0.4 ? rand(2_000, 30_000) : 0);
  const tokensOutput = rand(500, 12_000);
  const tokensReasoning = isProxy ? 0 : rand(0, Math.floor(tokensOutput * 0.5));

  const messageCount = rand(4, 24);
  const toolCallCount = rand(2, 40);

  return {
    sessionId, title, cwd, model, agent,
    directory: cwd,
    cost: 0,
    tokensInput, tokensOutput, tokensReasoning, tokensCacheRead, tokensCacheWrite,
    timeCreated: start.getTime(),
    timeUpdated: end.getTime(),
    messageCount, toolCallCount,
  };
}

// Schema subset matching the real opencode.db columns the adapter reads.
const OPENCODE_SCHEMA = `
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  directory TEXT NOT NULL,
  title TEXT,
  agent TEXT,
  model TEXT,
  cost REAL NOT NULL DEFAULT 0,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX message_session_idx ON message (session_id);
CREATE INDEX part_session_idx ON part (session_id);
`;

function insertOpenCodeSession(db, s) {
  db.prepare(
    `INSERT INTO session (id, directory, title, agent, model, cost,
        tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        time_created, time_updated)
     VALUES (@sessionId, @directory, @title, @agent, @model, @cost,
        @tokensInput, @tokensOutput, @tokensReasoning, @tokensCacheRead, @tokensCacheWrite,
        @timeCreated, @timeUpdated)`,
  ).run(s);

  // Insert enough message + part rows to satisfy the count subqueries. Parts
  // alternate text/tool so the `type='tool'` count matches toolCallCount.
  const msgStmt = db.prepare(
    `INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`,
  );
  const partStmt = db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  );
  let partSeq = 0;
  for (let m = 0; m < s.messageCount; m++) {
    const msgId = `msg_${s.sessionId}_${m}`;
    const msgTime = s.timeCreated + Math.floor((s.timeUpdated - s.timeCreated) * (m / Math.max(1, s.messageCount)));
    msgStmt.run(msgId, s.sessionId, msgTime, JSON.stringify({ role: m % 2 === 0 ? "user" : "assistant" }));
    // One text part per message.
    partStmt.run(
      `prt_${s.sessionId}_${partSeq++}`,
      msgId, s.sessionId, msgTime,
      JSON.stringify({ type: "text", text: `message ${m}` }),
    );
  }
  // Spread tool parts across the messages.
  for (let t = 0; t < s.toolCallCount; t++) {
    const ownerMsg = `msg_${s.sessionId}_${t % s.messageCount}`;
    partStmt.run(
      `prt_${s.sessionId}_${partSeq++}`,
      ownerMsg, s.sessionId, s.timeCreated + t * 1000,
      JSON.stringify({ type: "tool", tool: "edit_file", state: "completed" }),
    );
  }
}

// ---------------------------------------------------------------------------
// GitHub Copilot Chat (token-bearing JSONL — VS Code chatSessions format)
// ---------------------------------------------------------------------------

// Each chatSessions line is {kind, v} (sometimes {kind, k, v}). `kind` is NOT
// a reliable discriminator (kind:1 lines have bool/string/list/dict subtypes),
// so the adapter discriminates by SHAPE: a request is an array whose items have
// `requestId`; a token response is an object with a `metadata` object. We emit
// a few noise lines (boolean / progressive-chunk list) matching the real format
// to exercise the shape-based detection.
function makeCopilotSession({ project, dayOffset, idx, emptyWindow }) {
  const sessionId = uuidFrom(`copilot-${project ? project.slug : "empty"}-${dayOffset}-${idx}`);
  const start = new Date();
  start.setDate(start.getDate() - dayOffset);
  start.setHours(rand(8, 22), rand(0, 59), 0, 0);
  const durationMin = rand(4, 90);
  const end = new Date(start.getTime() + durationMin * 60_000);

  const title = project ? `${project.titlePrefix}: ${pick(TITLE_FRAGMENTS)}` : pick(TITLE_FRAGMENTS);
  const cwd = emptyWindow ? null : project ? project.cwd : null;
  const primaryModel = pick(COPILOT_MODELS);
  const lines = [];

  // kind:0 header — creationDate is epoch ms; inputState.selectedModel.metadata
  // carries the model id (without copilot/ prefix) used as the adapter fallback.
  lines.push({
    kind: 0,
    v: {
      version: 3,
      creationDate: start.getTime(),
      initialLocation: "panel",
      responderUsername: "GitHub Copilot",
      sessionId,
      hasPendingEdits: false,
      requests: [],
      pendingRequests: [],
      inputState: {
        selectedModel: {
          metadata: {
            id: primaryModel.id,
            name: primaryModel.name,
            family: primaryModel.id,
            vendor: primaryModel.vendor,
            version: "1",
            multiplier: `${primaryModel.multiplier}x`,
            multiplierNumeric: primaryModel.multiplier,
            detail: `${primaryModel.multiplier}x`,
            capabilities: { vision: true, toolCalling: true, agentMode: true },
          },
        },
      },
    },
  });

  // Noise line the adapter must ignore: kind:1 with a boolean v (real sessions
  // echo flags like isCanceled as standalone lines).
  lines.push({ kind: 1, v: false });

  const turns = rand(3, 14);
  const stepMs = (end.getTime() - start.getTime()) / turns;
  for (let t = 0; t < turns; t++) {
    const ts = new Date(start.getTime() + stepMs * t);
    const model = Math.random() < 0.85 ? primaryModel : pick(COPILOT_MODELS);
    const turnModelId = model.vendor === "copilot" ? `copilot/${model.id}` : model.id;

    // kind:2 request list — one user message per turn.
    lines.push({
      kind: 2,
      v: [
        {
          requestId: `request_${uuidFrom(`${sessionId}-${t}`)}`,
          timestamp: ts.getTime(),
          agent: {
            extensionId: { value: "GitHub.copilot-chat", _lower: "github.copilot-chat" },
            extensionVersion: "0.55.0",
            publisherDisplayName: "GitHub",
            extensionPublisherId: "GitHub",
            extensionDisplayName: "GitHub Copilot Chat",
            id: "github.copilot.editsAgent",
            name: "agent",
            fullName: "GitHub Copilot",
            isDefault: true,
            locations: ["panel"],
            modes: ["agent"],
          },
          modelId: turnModelId,
          responseId: `r_${uuidFrom(`${sessionId}-${t}-r`)}`,
          modelState: 0,
          contentReferences: [],
          codeCitations: [],
          timeSpentWaiting: rand(0, 4000),
          response: [],
          message: { text: t === 0 ? title : `turn ${t + 1}`, parts: [{ kind: "markdown", value: t === 0 ? title : `turn ${t + 1}` }] },
          variableData: [],
        },
      ],
    });

    // Noise line: kind:2 list of progressive assistant output chunks — items
    // lack `requestId`, so the adapter's isRequestList must skip them.
    lines.push({ kind: 2, v: [{ kind: "markdown", value: "working", id: `chunk_${t}` }] });

    // kind:1 token response — metadata holds promptTokens/outputTokens/
    // toolCallRounds (the only fields the adapter reads off v.metadata).
    const isBigModel = model.id.includes("opus") || model.id.includes("o4");
    const promptTokens = rand(isBigModel ? 20_000 : 4_000, isBigModel ? 200_000 : 60_000);
    const outputTokens = rand(100, model.id.includes("codex") ? 6_000 : 2_500);
    const thinkingTokens = model.thinking ? rand(0, 2_000) : 0;
    const toolRounds = rand(0, 4);
    const toolCallRounds = [];
    for (let r = 0; r < toolRounds; r++) {
      const toolCount = rand(1, 3);
      const toolCalls = [];
      for (let u = 0; u < toolCount; u++) {
        toolCalls.push({
          id: `toolu_vrtx_${idFrom(sessionId + t + r + u)}`,
          name: pick(COPILOT_TOOLS),
          arguments: JSON.stringify({ query: "demo", path: cwd ? `${cwd}/src` : "/tmp" }),
          type: "function",
        });
      }
      toolCallRounds.push({
        response: "",
        toolCalls,
        toolInputRetry: 0,
        id: uuidFrom(`${sessionId}-${t}-${r}`),
        thinking: { id: `thinking_${t}_${r}`, text: "…", encrypted: "", tokens: thinkingTokens },
        timestamp: new Date(ts.getTime() + r * 1000).toISOString(),
      });
    }
    lines.push({
      kind: 1,
      v: {
        timings: { firstProgress: rand(100, 4000), totalElapsed: rand(2000, 60_000) },
        metadata: {
          promptTokens,
          outputTokens,
          toolCallRounds,
          toolCallResults: toolCallRounds.map(() => ({ toolCallId: `toolu_vrtx_${idFrom(sessionId + Math.random())}`, response: "ok" })),
          resolvedModel: null, // null in practice — adapter uses the request modelId
          responseId: `r_${uuidFrom(`${sessionId}-${t}-r`)}`,
          sessionId,
          agentId: "github.copilot.editsAgent",
          modelMessageId: `mm_${uuidFrom(`${sessionId}-${t}-mm`)}`,
          cacheKey: `ck_${idFrom(sessionId + t)}`,
          codeBlocks: [],
          renderedUserMessage: [{ type: 1, text: `<userRequest>${t === 0 ? title : `turn ${t + 1}`}</userRequest>` }],
          renderedGlobalContext: [{ type: 1, text: `<workspace_info>${cwd || "/Users/demo"}</workspace_info>` }],
        },
        details: `${model.name} • ${model.multiplier}x`,
        usage: {
          completionTokens: outputTokens,
          promptTokens,
          promptTokenDetails: [
            { category: "System", label: "System Instructions", percentageOfPrompt: 5 },
            { category: "User Context", label: "Messages", percentageOfPrompt: 55 },
          ],
        },
      },
    });
  }

  return { sessionId, title, cwd, start, end, lines };
}

// ---------------------------------------------------------------------------

async function main() {
  await rm(OUT, { recursive: true, force: true });
  let claudeCount = 0;
  let codexCount = 0;
  let antiCount = 0;
  let openCount = 0;
  let copilotCount = 0;
  const codexIndex = [];

  // OpenCode: one SQLite db for all sessions.
  await mkdir(OPENCODE_OUT, { recursive: true });
  const opencodeDb = new Database(join(OPENCODE_OUT, "opencode.db"));
  opencodeDb.exec(OPENCODE_SCHEMA);
  const insertOpen = opencodeDb.transaction((s) => insertOpenCodeSession(opencodeDb, s));

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

    // OpenCode — per-session aggregates in SQLite (token-bearing)
    const openPer = rand(3, 6);
    for (let i = 0; i < openPer; i++) {
      const dayOffset = rand(0, 29);
      const s = makeOpenCodeSession({ project, dayOffset, idx: i });
      insertOpen(s);
      openCount++;
    }

    // GitHub Copilot Chat — JSONL chatSessions under workspaceStorage/<hash>/.
    // One workspace.json per hash dir maps the hash to the workspace folder URI;
    // the adapter reads it to resolve cwd. One chatSessions/<id>.jsonl per
    // session, matching the {kind, v} format the adapter parses by shape.
    const hash = hashFrom(project.cwd);
    const wsDir = join(COPILOT_OUT, "workspaceStorage", hash);
    const chatDir = join(wsDir, "chatSessions");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(wsDir, "workspace.json"), JSON.stringify({ folder: `file://${project.cwd}` }) + "\n", "utf8");
    const copilotPer = rand(3, 7);
    for (let i = 0; i < copilotPer; i++) {
      const dayOffset = rand(0, 29);
      const s = makeCopilotSession({ project, dayOffset, idx: i, emptyWindow: false });
      const file = join(chatDir, `${s.sessionId}.jsonl`);
      const body = s.lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      await writeFile(file, body, "utf8");
      copilotCount++;
    }
  }

  // GitHub Copilot Chat — empty-window sessions (no workspace, cwd=null →
  // project "Copilot (empty window)"). These live under globalStorage/.
  const emptyDir = join(COPILOT_OUT, "globalStorage", "emptyWindowChatSessions");
  await mkdir(emptyDir, { recursive: true });
  const emptyPer = rand(3, 6);
  for (let i = 0; i < emptyPer; i++) {
    const dayOffset = rand(0, 29);
    const s = makeCopilotSession({ project: null, dayOffset, idx: i, emptyWindow: true });
    const file = join(emptyDir, `${s.sessionId}.jsonl`);
    const body = s.lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    await writeFile(file, body, "utf8");
    copilotCount++;
  }

  // Codex title index
  const indexDir = dirname(join(CODEX_OUT, "session_index.jsonl"));
  await mkdir(indexDir, { recursive: true });
  const indexBody = codexIndex.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(join(CODEX_OUT, "session_index.jsonl"), indexBody, "utf8");

  opencodeDb.close();

  console.log(
    `Wrote ${claudeCount} Claude sessions to ${join(OUT, "projects")}, ${codexCount} Codex rollouts (+ index) to ${CODEX_OUT}, ${antiCount} Antigravity transcripts to ${ANTI_OUT}, ${openCount} OpenCode sessions to ${join(OPENCODE_OUT, "opencode.db")}, and ${copilotCount} Copilot Chat sessions to ${COPILOT_OUT}`,
  );
}

await main();