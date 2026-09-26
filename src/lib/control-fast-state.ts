import fs from "fs";
import { resolveSessionFile, stateFile } from "@/lib/agent-config";
import { SENTINEL_VALIDITY_S } from "@/lib/constants/control";
import { parseSessionFile } from "@/lib/session-content";
import type { CurrentPrompt, SessionState } from "@/lib/control-types";

export function parseSession(tab: string, adapter = "claude"): SessionState | null {
  const file = resolveSessionFile(tab, adapter);
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const fields = parseSessionFile(raw);
    const mtime = fs.statSync(file).mtimeMs;
    // Project the kebab-case loop-control fields into camelCase SessionState
    // shape. Kept narrow: only the two structured fields are surfaced; the
    // other kebab fields (last-3-same-dir, wip-or-revert-in-last-5) stay in
    // OrchestrationTaskSummary's purview and don't leak into ProjectState.
    const blockReasonRaw = fields["block-reason"]?.trim();
    const noOpCountRaw = fields["no-op-count"]?.trim();
    const noOpCount =
      noOpCountRaw && /^\d+$/.test(noOpCountRaw) ? parseInt(noOpCountRaw, 10) : undefined;
    return {
      ...fields,
      ...(blockReasonRaw ? { blockReason: blockReasonRaw } : {}),
      ...(noOpCount !== undefined ? { noOpCount } : {}),
      mtime,
    };
  } catch {
    return null;
  }
}

export function readTmpTs(filename: string): number | null {
  try {
    if (fs.existsSync(filename)) {
      const ts = parseInt(fs.readFileSync(filename, "utf-8").trim(), 10);
      return isNaN(ts) ? null : ts;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function readCurrentPrompt(tab: string): CurrentPrompt | null {
  try {
    const file = stateFile.prompt(tab);
    if (!fs.existsSync(file)) return null;
    const obj = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (
      typeof obj?.key === "string" &&
      typeof obj?.label === "string" &&
      typeof obj?.startedAt === "number"
    ) {
      return obj as CurrentPrompt;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type AgentProcess = {
  agentId: string;
  cwd: string;
  sessionLifecycleSignals: boolean;
  /** OS pid. Lets callers key a process stably and read its /proc entry. */
  pid: number;
};

export function getAgentProcesses(
  agents: Array<{
    id: string;
    processMatchers: string[];
    capabilities: { sessionLifecycleSignals: boolean };
  }>,
): AgentProcess[] {
  const processes: AgentProcess[] = [];
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, "utf-8");
        // Match against argv[0] basename only — a full-string scan of the whole
        // cmdline produces false positives when shell-snapshot scripts are run via
        // `/bin/bash -c source /home/g/.claude/shell-snapshots/...` (the path
        // contains "claude" but the process is just a bash helper, not the agent).
        const argv0 = cmdline.split("\0")[0] ?? "";
        const basename = argv0.includes("/") ? argv0.split("/").pop()! : argv0;
        const agent = agents.find((candidate) =>
          candidate.processMatchers.some((m) => {
            if (m === "agent" && candidate.id === "cursor") {
              return (
                basename === "agent" &&
                (argv0.includes(".local/bin/agent") || argv0.includes("/.cursor/"))
              );
            }
            return basename === m || basename === `${m}.exe` || basename.startsWith(`${m}-`);
          }),
        );
        if (!agent) continue;
        const cwd = fs.readlinkSync(`/proc/${entry}/cwd`);
        processes.push({
          agentId: agent.id,
          cwd,
          sessionLifecycleSignals: agent.capabilities.sessionLifecycleSignals,
          pid: Number(entry),
        });
      } catch {
        // process disappeared mid-scan
      }
    }
  } catch {
    // /proc unavailable
  }
  return processes;
}

/** One live Claude Code session as reported by the CLI itself. */
export type ClaudeLiveSession = {
  pid: number;
  cwd: string;
  /** "idle" (at the composer) vs anything else (generating/working). */
  status: string;
  /** Epoch seconds of the last status flip. */
  statusUpdatedAtS: number;
  /** What a "waiting" session waits for, in the CLI's own words ("dialog open"). */
  waitingFor?: string;
};

/**
 * Claude is showing a dialog (an onboarding question, a settings prompt) over
 * its composer. Anything typed into the session answers the dialog instead of
 * reaching the agent: Farmhouse sat on "Teach auto mode about your
 * environment?" and swallowed the owner's note while the widget said "On it"
 * (2026-09-26). The CLI says so itself, so this reads its words, not the screen.
 */
export function claudeDialogOpen(s: ClaudeLiveSession | null): boolean {
  return !!s && s.status === "waiting" && /dialog/i.test(s.waitingFor ?? "");
}

/**
 * Claude Code (>= 2.x) writes live per-PID session status to
 * ~/.claude/sessions/<pid>.json ({cwd, status, statusUpdatedAt}). This is the
 * CLI's OWN ground truth for "is the agent generating right now" — no hooks,
 * no handoff files. Two consumers:
 *   - dispatch verification (poller): "did the injected prompt actually
 *     submit" = status leaves "idle". The old output-activity heuristic was
 *     fooled by boot-screen redraw, acking "injected" while the paste had
 *     been eaten by the trust-folder dialog (2026-07-02: six agents launched,
 *     all idle, all acked ok).
 *   - runtime pusher (readFastState): synthesizes the "direct_terminal"
 *     observation for agents with no prompt state file (headless box).
 * Dead PIDs are skipped — a killed agent must not leave a forever-"working"
 * ghost. Newest statusUpdatedAt wins per cwd.
 */
export function readClaudeLiveSessions(): Map<string, ClaudeLiveSession> {
  const byCwd = new Map<string, ClaudeLiveSession>();
  const dir = `${process.env.HOME ?? ""}/.claude/sessions`;
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return byCwd; // no session dir — older CLI or non-claude agent
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf-8")) as {
        pid?: number;
        cwd?: string;
        status?: string;
        statusUpdatedAt?: number;
        updatedAt?: number;
        waitingFor?: string;
      };
      if (!raw.pid || !raw.cwd || typeof raw.status !== "string") continue;
      if (!fs.existsSync(`/proc/${raw.pid}`)) continue; // stale file, dead agent
      const entry: ClaudeLiveSession = {
        pid: raw.pid,
        cwd: raw.cwd,
        status: raw.status,
        // Current CLIs write `updatedAt`; older ones `statusUpdatedAt`.
        statusUpdatedAtS: Math.floor((raw.statusUpdatedAt ?? raw.updatedAt ?? 0) / 1000),
        ...(typeof raw.waitingFor === "string" && { waitingFor: raw.waitingFor }),
      };
      const prev = byCwd.get(raw.cwd);
      if (!prev || entry.statusUpdatedAtS > prev.statusUpdatedAtS) byCwd.set(raw.cwd, entry);
    } catch {
      /* unreadable/partial write — skip */
    }
  }
  return byCwd;
}

/** Newest live Claude session running in `dir` (or a subdirectory of it). */
export function claudeLiveSessionForDir(
  sessions: Map<string, ClaudeLiveSession>,
  dir: string,
): ClaudeLiveSession | null {
  let best: ClaudeLiveSession | null = null;
  for (const [cwd, s] of sessions) {
    if (cwd !== dir && !cwd.startsWith(`${dir}/`)) continue;
    if (!best || s.statusUpdatedAtS > best.statusUpdatedAtS) best = s;
  }
  return best;
}

export type FastProjectState = {
  tab: string;
  workspaceId?: string | null;
  agentRunning: boolean;
  tabOpen: boolean;
  activeAgents: string[];
  session: SessionState | null;
  currentPrompt: CurrentPrompt | null;
  readyAt: number | null;
  lockAt: number | null;
  closingAt: number | null;
  closedAt: number | null;
  // Per-tab state previously fetched by per-card polling. Always set when the
  // stream sources from the DB; left undefined by the local /proc path so the
  // hook-side fallback still does a one-shot HTTP load.
  promptQueue?: string[];
  promptQueueRevision?: number;
  autoContinueEnabled?: boolean;
};

export function readFastState(
  projects: Array<{
    tab: string;
    dir: string;
    sessionLifecycleSignals?: boolean;
    activeAgents?: string[];
    tabOpen?: boolean;
  }>,
  agentCwds: string[],
): FastProjectState[] {
  const nowS = Math.floor(Date.now() / 1000);
  const liveSessions = readClaudeLiveSessions();
  return projects.map(
    ({ tab, dir, sessionLifecycleSignals = true, activeAgents = [], tabOpen = false }) => {
      const tmpReady = readTmpTs(stateFile.ready(tab));
      const tmpLock = readTmpTs(stateFile.lock(tab));
      const tmpClosing = readTmpTs(stateFile.closing(tab));
      const tmpClosed = readTmpTs(stateFile.closed(tab));

      const rawCurrentPrompt = readCurrentPrompt(tab);
      let currentPrompt =
        sessionLifecycleSignals || rawCurrentPrompt?.source === "runner" ? rawCurrentPrompt : null;
      // No prompt state file (headless box: nothing writes /tmp prompt state)
      // but the CLI itself says it is generating → surface it as the
      // direct-terminal observation so the agent reads as Working instead of
      // "process detected, no lifecycle signal".
      if (!currentPrompt) {
        const live = claudeLiveSessionForDir(liveSessions, dir);
        if (live && live.status !== "idle") {
          currentPrompt = {
            key: "direct_terminal",
            label: "Direct terminal activity",
            startedAt: live.statusUpdatedAtS,
          };
        }
      }

      const liveAdapter = activeAgents[0] ?? "claude";
      return {
        tab,
        agentRunning: agentCwds.some((cwd) => cwd === dir || cwd.startsWith(dir + "/")),
        tabOpen,
        activeAgents,
        session: parseSession(tab, liveAdapter),
        currentPrompt,
        readyAt: tmpReady !== null && nowS - tmpReady < SENTINEL_VALIDITY_S ? tmpReady : null,
        lockAt: tmpLock !== null && nowS - tmpLock < SENTINEL_VALIDITY_S ? tmpLock : null,
        closingAt:
          tmpClosing !== null && nowS - tmpClosing < SENTINEL_VALIDITY_S ? tmpClosing : null,
        closedAt: tmpClosed !== null && nowS - tmpClosed < SENTINEL_VALIDITY_S ? tmpClosed : null,
      };
    },
  );
}
