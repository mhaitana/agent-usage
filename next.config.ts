import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local-only dashboard reading ~/.claude; no external requests.

  // better-sqlite3 ships a native .node binary; keep it out of the JS bundler
  // so Turbopack/webpack doesn't try to compile it. (Used by the OpenCode
  // adapter to read ~/.local/share/opencode/opencode.db.)
  serverExternalPackages: ["better-sqlite3"],

  // Ship the committed demo-data/ JSONL in the serverless bundle so a Vercel
  // deploy with CLAUDE_DIR=./demo-data has the sample transcripts at runtime.
  // Next's file tracer can't see files read via readdir at runtime, so we
  // include them explicitly. See README "Demo deployment".
  outputFileTracingIncludes: {
    "/*": [
      "./demo-data/**/*.jsonl",
      // Antigravity transcripts live under a dot-dir (.system_generated/logs);
      // include explicitly in case the tracer skips dot-dirs.
      "./demo-data/antigravity/brain/**/.system_generated/logs/*.jsonl",
      // OpenCode demo db (SQLite) + its WAL files, read by the OpenCode adapter.
      "./demo-data/opencode/**/*.db",
      "./demo-data/opencode/**/*.db-wal",
      "./demo-data/opencode/**/*.db-shm",
    ],
  },
};

export default nextConfig;