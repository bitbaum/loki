/**
 * Per-run token usage from Claude Code transcripts.
 *
 * The runner host is the only place the agent's token spend exists at all:
 * Claude Code writes one JSONL transcript per session under
 * ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl, and each assistant message
 * line carries `message.usage` (input/output/cache tokens) and
 * `message.model`. Nothing else — no API, no hook — reports usage, so the
 * runner tails these files and attributes tokens to runs by TIME WINDOW:
 * a run owns every assistant message generated in its cwd between delivery
 * (deliveredAt) and close. That stays correct even when one long-lived
 * Claude session spans many runs, which is the normal fleet shape.
 *
 * Dedup: an assistant turn with N content blocks is written as N JSONL lines
 * sharing one `message.id` and identical usage — summing raw lines
 * double-counts. Dedupe on message.id (fall back to the line uuid).
 */
import fs from "fs";
import os from "os";
import path from "path";

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type WindowUsage = {
  totals: UsageTotals;
  /** Per-model breakdown — pricing happens box-side against this map. */
  models: Record<string, UsageTotals>;
  /** Distinct assistant messages counted (post-dedup). */
  messageCount: number;
  /** Claude session ids that contributed usage in the window. */
  sessionIds: string[];
};

export const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

/**
 * Claude Code names a project's log folder after its cwd with EVERY character
 * that is not a letter or digit turned into "-" (e.g. /a/b/.claude/x →
 * -a-b--claude-x). This used to replace only "/" and ".", which agreed for
 * most paths and silently missed the rest: workspace and worktree names may
 * carry "_" (box-workspace-path and worktree-workspace both allow it), and
 * for those the transcript stream, the usage collector and the auth canary
 * all looked in a folder that never exists.
 *
 * Paths whose slug passes CLAUDE_SLUG_MAX are truncated by Claude Code and
 * given a hash suffix we do not reproduce; callers that must find such a
 * folder match on the truncated prefix (see transcript-streamer.ts).
 */
export function claudeProjectSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Beyond this length Claude Code truncates the folder name and adds a hash. */
export const CLAUDE_SLUG_MAX = 200;

type TranscriptLine = {
  uuid?: string;
  timestamp?: string;
  type?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
};

function addTotals(
  into: UsageTotals,
  u: NonNullable<NonNullable<TranscriptLine["message"]>["usage"]>,
): void {
  into.input += u.input_tokens ?? 0;
  into.output += u.output_tokens ?? 0;
  into.cacheRead += u.cache_read_input_tokens ?? 0;
  into.cacheWrite += u.cache_creation_input_tokens ?? 0;
}

/**
 * Sum assistant-message usage for `dir` within [fromMs, toMs].
 *
 * Only transcripts touched since `fromMs` are opened (mtime prune) — a
 * session that ended before the window can't contain window entries.
 * Returns null when the project has no transcript directory at all
 * (non-Claude agent, or the agent never started).
 */
export function collectClaudeUsage(
  dir: string,
  fromMs: number,
  toMs: number,
  home: string = os.homedir(),
): WindowUsage | null {
  const projDir = path.join(home, ".claude", "projects", claudeProjectSlug(dir));
  let files: string[];
  try {
    files = fs.readdirSync(projDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }

  const usage: WindowUsage = { totals: emptyTotals(), models: {}, messageCount: 0, sessionIds: [] };
  const seenMessageIds = new Set<string>();

  for (const file of files) {
    const full = path.join(projDir, file);
    let raw: string;
    try {
      if (fs.statSync(full).mtimeMs < fromMs) continue;
      raw = fs.readFileSync(full, "utf-8");
    } catch {
      continue; // rotated/unreadable mid-scan — skip, next tick recovers
    }
    let contributed = false;
    for (const line of raw.split("\n")) {
      if (!line || !line.includes('"usage"')) continue;
      let entry: TranscriptLine;
      try {
        entry = JSON.parse(line) as TranscriptLine;
      } catch {
        continue;
      }
      if (entry.type !== "assistant") continue;
      const u = entry.message?.usage;
      if (!u) continue;
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) continue;
      const dedupeKey = entry.message?.id ?? entry.uuid;
      if (dedupeKey) {
        if (seenMessageIds.has(dedupeKey)) continue;
        seenMessageIds.add(dedupeKey);
      }
      addTotals(usage.totals, u);
      const model = entry.message?.model ?? "unknown";
      usage.models[model] ??= emptyTotals();
      addTotals(usage.models[model], u);
      usage.messageCount += 1;
      contributed = true;
    }
    if (contributed) usage.sessionIds.push(path.basename(file, ".jsonl"));
  }

  return usage;
}
