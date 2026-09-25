/**
 * Shared helpers for reading Claude's local configuration files.
 * SSOT for all path constants and file-reading logic used by the
 * /api/control and /api/inject routes.
 *
 * STATE FILE CONTRACT
 * ───────────────────
 * Loki (inject/control routes) and dotfiles (stop.sh, notification.sh)
 * communicate exclusively through these /tmp sentinel files.
 * The bash scripts duplicate the names as string literals — keep in sync.
 *
 *   claude-ready-<TAB>            Normal stop: Claude finished a turn, popup shown
 *   claude-closing-<TAB>          close_session prompt is currently running
 *   claude-closed-<TAB>           close_session finished (stop.sh consumed sentinel)
 *   claude-session-closed-<TAB>   Sentinel: close_session was chosen; stop.sh consumes this
 *   claude-current-prompt-<TAB>   JSON: { key, label, startedAt } of running prompt
 *   claude-stop-active-<TAB>      Lock: stop-hook popup is open; notification.sh must wait
 */
import fs from "fs";
import { homedir } from "node:os";
import path from "path";
import { APP_SLUG } from "@/config/brand";
import { fleetSessionsDir, legacyClaudeSessionsDir } from "@/lib/session-paths";

// Lazy accessors — evaluated at request time, not module load time.
// Module-level path.join(process.env.HOME, …) causes Turbopack's NFT tracer
// to walk from HOME (the parent of the project root) and accidentally include
// next.config.ts in the route bundle.
const home = () => process.env.HOME ?? homedir();

const PROJECTS_CONF = () =>
  process.env.AGENT_PROJECTS_CONF ??
  path.join(/*turbopackIgnore: true*/ home(), ".config", "agent-projects.conf");
const CLAUDE_PROJECTS_CONF = () =>
  path.join(/*turbopackIgnore: true*/ home(), ".config", "claude-projects.conf");

export const PROMPTS_FILE = () =>
  process.env.AGENT_PROMPTS_FILE ??
  path.join(/*turbopackIgnore: true*/ home(), ".config", "agent-prompts.json");
const CLAUDE_PROMPTS_FILE = () =>
  path.join(/*turbopackIgnore: true*/ home(), ".config", "claude-prompts.json");

export const SESSIONS_DIR = () => fleetSessionsDir(home());

/** Per-adapter handoff directory — mirrors scripts/_agents.sh `_agent_session_dir`. */
export function agentSessionDir(adapter: string): string {
  if (adapter === "grok") {
    return path.join(/*turbopackIgnore: true*/ home(), ".grok", "sessions");
  }
  return SESSIONS_DIR();
}

export function sessionFilePath(tab: string, adapter = "claude"): string {
  return path.join(agentSessionDir(adapter), `${tab}.md`);
}

/**
 * Resolve the actual on-disk session file for a tab, tolerating case drift.
 *
 * The control poll reads handoffs by the LIVE tab name (what
 * resolveEffectiveTab returns, e.g. "Loki"), but agents/tooling write the
 * handoff with their own casing ("Loki.md"). A case-sensitive lookup
 * misses the file, so parseSession returns null and the live completion signal
 * is lost — which (among other things) leaves orchestration runs unclosed.
 *
 * Returns the exact-case path when it exists (fast path, no dir scan), otherwise
 * the most-recently-modified case-insensitive match in the adapter's session dir
 * (newest = the live handoff when several case variants linger), or null.
 */
export function resolveSessionFile(tab: string, adapter = "claude"): string | null {
  const target = `${tab}.md`.toLowerCase();
  let best: { path: string; mtimeMs: number } | null = null;
  const dirs =
    adapter === "claude"
      ? [agentSessionDir(adapter), legacyClaudeSessionsDir(home())]
      : [agentSessionDir(adapter)];
  for (const dir of new Set(dirs)) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.toLowerCase() !== target) continue;
        const full = path.join(dir, name);
        const mtimeMs = fs.statSync(full).mtimeMs;
        if (!best || mtimeMs > best.mtimeMs) best = { path: full, mtimeMs };
      }
    } catch {
      /* session dir missing */
    }
  }
  return best?.path ?? null;
}

// ── State file helpers ────────────────────────────────────────────────────────
// Single place where the /tmp/<name>-<tab> file names are defined for TypeScript.
// Bash scripts in ~/.claude/hooks/ duplicate these as string literals — if you
// rename any of these, update stop.sh and notification.sh to match.

export const stateFile = {
  ready: (tab: string) => path.join("/tmp", /*turbopackIgnore: true*/ `agent-ready-${tab}`),
  closing: (tab: string) => path.join("/tmp", /*turbopackIgnore: true*/ `agent-closing-${tab}`),
  closed: (tab: string) => path.join("/tmp", /*turbopackIgnore: true*/ `agent-closed-${tab}`),
  sentinel: (tab: string) =>
    path.join("/tmp", /*turbopackIgnore: true*/ `agent-session-closed-${tab}`),
  prompt: (tab: string) =>
    path.join("/tmp", /*turbopackIgnore: true*/ `agent-current-prompt-${tab}`),
  lock: (tab: string) => path.join("/tmp", /*turbopackIgnore: true*/ `agent-stop-active-${tab}`),
  queue: (tab: string) =>
    path.join("/tmp", /*turbopackIgnore: true*/ `agent-queue-${tab.toLowerCase()}`),
  run: (tab: string) => path.join("/tmp", /*turbopackIgnore: true*/ `${APP_SLUG}-run-${tab}`),

  // Legacy names — no new files are written with these names; only used to delete stale on-disk files.
  claudeReady: (tab: string) => path.join("/tmp", /*turbopackIgnore: true*/ `claude-ready-${tab}`),
  claudeClosed: (tab: string) =>
    path.join("/tmp", /*turbopackIgnore: true*/ `claude-closed-${tab}`),
} as const;

/** Delete all handshake state files for a tab, ignoring missing-file errors. */
export function clearHandshakeFiles(tab: string): void {
  for (const p of [
    stateFile.ready(tab),
    stateFile.claudeReady(tab),
    stateFile.closed(tab),
    stateFile.claudeClosed(tab),
  ]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* already gone */
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PromptMeta = {
  key: string;
  slot: number | null;
  icon: string;
  label: string;
  style: string;
  category: string;
  prompt?: string;
};

type PromptConfig = PromptMeta & { prompt: string };

// ── Parsers ───────────────────────────────────────────────────────────────────

/**
 * Parse claude-projects.conf → ordered array of { tab, dir } entries.
 * Deduplicates by tab name (case-insensitive, first occurrence wins).
 */
export function parseProjectsConf(): { tab: string; dir: string }[] {
  let file = PROJECTS_CONF();
  if (!fs.existsSync(file)) {
    file = CLAUDE_PROJECTS_CONF();
  }
  if (!fs.existsSync(file)) return [];
  const seen = new Set<string>();
  const result: { tab: string; dir: string }[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("|");
    if (parts.length < 2) continue;
    const tab = parts[0].trim();
    const dir = parts[1].trim();
    if (!seen.has(tab.toLowerCase())) {
      seen.add(tab.toLowerCase());
      result.push({ tab, dir });
    }
  }
  return result;
}

/**
 * Given a canonical tab name and the currently live tab names (the owned PTYs
 * the runner reports), return the live tab name to use for injection and
 * /tmp sentinel files.
 *
 * IMPORTANT: always returns the EXACT casing from activeTabs (the runner's
 * ground truth), never from the conf file. Matching is case-insensitive
 * because the owned-PTY workspace id is lower-cased — but session handoff
 * files and /tmp sentinels are written under the live name, so returning conf
 * casing would look up `sessions/Loki.md` while the agent wrote
 * `sessions/Loki.md` and silently lose the completion signal.
 */
export function resolveEffectiveTab(canonical: string, activeTabs: string[]): string {
  if (!activeTabs.length) return canonical;
  // Return exact live casing — case-insensitive match, exact-case return
  const findAlive = (name: string) =>
    activeTabs.find((t) => t.toLowerCase() === name.toLowerCase());
  const liveMatch = findAlive(canonical);
  if (liveMatch) return liveMatch;
  // Human-created tab names often differ only by punctuation/casing from the
  // project key: `revampit` vs `revamp-it`, `Loki` vs `Loki`.
  // Treat those as the same tab before falling back to suffix matching.
  const normalizedCanonical = normalizeTabName(canonical);
  const normalizedMatch = activeTabs.find((tab) => normalizeTabName(tab) === normalizedCanonical);
  if (normalizedMatch) return normalizedMatch;
  const lower = canonical.toLowerCase();
  const suffixedMatch = activeTabs.find((tab) => {
    const active = tab.toLowerCase();
    return active.startsWith(`${lower} `) || active.startsWith(`${lower}-`);
  });
  if (suffixedMatch) return suffixedMatch;
  // Canonical not open; try a conf alias pointing to the same directory
  const all = parseProjectsConf();
  const canonicalDir = all.find((p) => p.tab.toLowerCase() === canonical.toLowerCase())?.dir;
  if (!canonicalDir) return canonical;
  const aliasEntry = all.find((p) => p.dir === canonicalDir && findAlive(p.tab));
  return aliasEntry ? (findAlive(aliasEntry.tab) ?? canonical) : canonical;
}

/** Punctuation/casing-insensitive tab key ("Prime tower" ≡ "prime-tower").
 *  Exported so DB-state joins keyed by project name use the SAME equivalence
 *  as live-tab resolution — a raw `.toLowerCase()` join left "Prime tower"
 *  permanently detached from the runner's "prime-tower" row. */
export function normalizeTabName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Read the unified claude-prompts.json (array format — SSOT for prompt text + metadata).
 */
function readPromptConfig(): PromptConfig[] {
  try {
    let file = PROMPTS_FILE();
    if (!fs.existsSync(file)) {
      file = CLAUDE_PROMPTS_FILE();
    }
    return JSON.parse(fs.readFileSync(file, "utf-8")) as PromptConfig[];
  } catch {
    return [];
  }
}

/** Backward-compat: derive metadata array from unified config. */
export function readPromptMeta(): PromptMeta[] {
  return readPromptConfig();
}

/** Backward-compat: derive key→prompt dict from unified config. */
export function readPrompts(): Record<string, string> {
  return Object.fromEntries(readPromptConfig().map((p) => [p.key, p.prompt]));
}

/**
 * Wrap a base prompt with session context from the project's session file.
 * If the session file exists, appends it + update instruction.
 * If not, asks Claude to create it with the standard fields.
 *
 * `projectStateDescription` (optional) — the SSOT one-line WHY for the
 * project's current state (e.g. "Stop hook fired recently — the agent
 * finished a turn and is ready for the next instruction"). When provided,
 * it is prepended as a "Project state:" line so the agent reads the same
 * inferred-state context the human sees on the badge hover tooltip.
 * Source: src/lib/control-states.ts -> projectStateDescription(stateKey).
 */
/**
 * The handoff exit-contract — SSOT for the field block every dispatched agent
 * must write when it finishes. Consumed by buildPromptWithSession (local
 * enrichment path) AND assembleInjectPrompt (cloud/queued path). The cloud
 * path once omitted it entirely, so box-executed agents finished real work,
 * searched ~/.loki/sessions/ for the contract, found nothing, wrote no
 * handoff — and their runs sat "waiting" until reaped as timeouts
 * (2026-07-02; laptop agents only ever complied because the founder's
 * personal global CLAUDE.md happens to describe the same contract).
 *
 * LOOP v2 handoff template (deployed 2026-05-25).
 * Gravity signals (last-3-same-dir, wip-or-revert) come FIRST so the next
 * session reads the drift state before any commit-summary narrative.
 * Replaces the legacy `health:` vanity field (always "good" exactly when
 * the loop was in trouble) with six auto-computed signals + the resume-
 * state-not-a-verb `next:` constraint.
 */
export function sessionHandoffContract(sessionFilePath: string): string {
  return [
    `When done, update ${sessionFilePath} with exactly these lines:`,
    "status: <ready | working>     # 'ready' = task fully done; 'working' = more to do. Auto-inject only fires when 'ready'.",
    "last-3-same-dir: <yes | no>   # gravity signal — `git log --format= --name-only -3 | grep -v '^$' | xargs -n1 dirname | sort -u | wc -l` == 1",
    "wip-or-revert-in-last-5: <yes | no>   # `git log --format=%s -5 | grep -ciE '^(wip|revert)'` > 0",
    "tsc: <pass | fail(N)>",
    "lint: <pass | fail(N errors, M warnings)>",
    "tests: <N pass · N fail, or 'no suite'>",
    "todos: <N from `rg -c '(TODO|FIXME|HACK)' src/`>",
    "done: <one sentence what you completed>",
    "next: <state to resume from — NOT a verb. EMPTY if nothing mid-flight; empty > lie.>",
    "commit: <short SHA you produced this run — `git rev-parse --short HEAD` — or 'none' if you committed nothing>",
  ].join("\n");
}

/**
 * The exit contract every dispatch ends with: where the agent must write its
 * handoff, and in what shape. The run closes only when that file reports
 * ready, so the path in here IS the run's identity to the close path.
 *
 * One builder, because three call sites each typed the heading and sentence
 * out by hand, and a parallel run must be able to REPLACE the contract rather
 * than append a second one: a prompt carrying two contracts tells the agent to
 * write its handoff to the base tab's file too — which closes whatever run
 * owns the base tab, not this one.
 */
export function exitContractFor(sessionFileRef: string): string {
  return `## Exit contract (operator requirement)\nBefore stopping, create ${sessionFileRef}.\n${sessionHandoffContract(sessionFileRef)}`;
}

// The pattern lives in the client-safe orchestration contract: activity-status
// (rendered in the browser) strips it, and this module imports fs.
export { EXIT_CONTRACT_PATTERN } from "@/lib/orchestration/contract";

export function buildPromptWithSession(
  base: string,
  tab: string,
  projectStateDescription?: string,
): string {
  const sessionFile = path.join(SESSIONS_DIR(), `${tab}.md`);
  const sessionUpdateBlock = sessionHandoffContract(sessionFile);

  // Project-state block — same one-line description the badge tooltip
  // shows, prepended so the agent reasons from the same context the
  // human sees. Empty when caller didn't provide it (transitional).
  const stateBlock = projectStateDescription ? `Project state: ${projectStateDescription}\n\n` : "";

  try {
    if (fs.existsSync(sessionFile)) {
      const session = fs.readFileSync(sessionFile, "utf-8");
      return `${stateBlock}${base}

Session state from last run:
${session}

${sessionUpdateBlock}`;
    }
  } catch {
    /* fall through */
  }

  return `${stateBlock}${base}

Before stopping, create ${sessionFile}.
${sessionUpdateBlock}`;
}
