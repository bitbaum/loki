/**
 * The cloud builder's memory of its open sessions, so a restart reopens them.
 *
 * A session is a PTY this process owns, and a restart of the process ends
 * every PTY in it. Every deploy that touched the runner restarted it once
 * nobody was mid-task, and the restart log said "idle sessions resume on
 * their next dispatch" — but nothing resumed them. The owner came back to
 * "No live sessions" five times in an afternoon (2026-10-19) and reasonably
 * read it as Loki having lost his work.
 *
 * So the builder writes down each session it opens (tab, folder, agent) and
 * crosses it off only when the session really ends: closed from Loki, or the
 * agent exited while the builder stayed up. On start it reopens what is still
 * written down. Claude Code keeps every conversation on disk, so a Claude
 * session comes back as the same conversation (`claude --resume <id>`, and
 * Codex by `codex resume --last`); the
 * other agents come back as a fresh session in the same folder.
 *
 * Off unless the box-runner turns it on: a laptop's Fleet Runner closing is a
 * person closing an app, and reopening their agents behind their back would
 * be a surprise, not a fix.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentOption } from "@/lib/agent-registry";

/** `shell` is a plain shell (lib/shell-session.ts): it comes back as a fresh
 *  login shell in the same folder, never as a conversation. */
export type RememberedAgent = AgentOption | 'shell';
export type RememberedTab = { tab: string; dir: string; agent: RememberedAgent };

/** How long an exit must stand before it counts as the session ending. A
 *  restart signals the agents and the builder at once; the builder is gone
 *  well inside this, so an exit caused by the restart is never recorded. */
export const EXIT_SETTLE_MS = 3000;

let file: string | null = null;
/** Bumped on every launch, so an old session's late exit cannot cross off
 *  the new one (an agent switch closes one and opens another in a breath). */
const generation = new Map<string, number>();

export function enableTabMemory(at: string): void {
  file = at;
}

export function tabMemoryEnabled(): boolean {
  return file !== null;
}

export function rememberedTabs(): RememberedTab[] {
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is RememberedTab =>
        typeof t?.tab === "string" && typeof t?.dir === "string" && typeof t?.agent === "string",
    );
  } catch {
    return [];
  }
}

function save(tabs: RememberedTab[]): void {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tabs, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn(`[tab-memory] could not save: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A session opened: write it down. Returns its generation. */
export function rememberTab(entry: RememberedTab): number {
  const key = entry.tab.toLowerCase();
  const gen = (generation.get(key) ?? 0) + 1;
  generation.set(key, gen);
  if (!file) return gen;
  save([...rememberedTabs().filter((t) => t.tab.toLowerCase() !== key), entry]);
  return gen;
}

/** A session ended for real. With `gen`, only if no newer one has opened. */
export function forgetTab(tab: string, gen?: number): void {
  const key = tab.toLowerCase();
  if (gen !== undefined && generation.get(key) !== gen) return;
  if (!file) return;
  const tabs = rememberedTabs();
  const kept = tabs.filter((t) => t.tab.toLowerCase() !== key);
  if (kept.length !== tabs.length) save(kept);
}

/**
 * Reopen every written-down session that is not already live. `launch` is
 * launchAgentPty; `sessionFor` names the Claude conversation to resume. One
 * failure (a folder gone, a CLI uninstalled) does not stop the others, and a
 * session that cannot come back is crossed off rather than retried forever.
 */
export async function restoreTabs(opts: {
  isLive: (tab: string) => boolean;
  launch: (tab: string, dir: string, agent: RememberedAgent, sessionId?: string) => Promise<void>;
  sessionFor: (dir: string) => Promise<string | null>;
  log?: (line: string) => void;
}): Promise<string[]> {
  const restored: string[] = [];
  for (const t of rememberedTabs()) {
    if (opts.isLive(t.tab)) continue;
    try {
      if (!fs.existsSync(t.dir)) throw new Error(`folder ${t.dir} is gone`);
      const sessionId = t.agent === "claude" ? ((await opts.sessionFor(t.dir)) ?? undefined) : undefined;
      await opts.launch(t.tab, t.dir, t.agent, sessionId);
      restored.push(t.tab);
      opts.log?.(`reopened ${t.tab} (${t.agent}${sessionId ? `, resumed ${sessionId}` : ""})`);
    } catch (e) {
      forgetTab(t.tab);
      opts.log?.(`could not reopen ${t.tab}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return restored;
}
