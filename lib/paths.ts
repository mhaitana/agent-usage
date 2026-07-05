import { homedir } from "node:os";
import { join } from "node:path";

/** Root Claude Code config directory, e.g. /Users/techtana/.claude */
export function claudeDir(): string {
  // Allow override via env for testing / alternate installs.
  return process.env.CLAUDE_DIR || join(homedir(), ".claude");
}

export function projectsDir(): string {
  return join(claudeDir(), "projects");
}

export function statsCachePath(): string {
  return join(claudeDir(), "stats-cache.json");
}