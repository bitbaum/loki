/**
 * Runner-side PTY execution — the Fleet Runner owning each agent's PTY directly
 * instead of puppeting zellij. Reuses the exact same Executor + launch helper the
 * server uses (src/lib/agent-execution), so a launch on the runner is byte-for-byte
 * the launch on the box: `bash -lic <registry launch command>` in an owned PTY.
 *
 * Why: a zellij `action go-to-tab-name` blocks forever on a detached session (a
 * headless/unattended laptop has no attached client), which is what made
 * launch/dispatch into revampit/kivvi time out. Owning the PTY removes the
 * dependency on an attached human terminal entirely.
 *
 * The owned PTY is the only place an agent runs on this runner. A tab with no
 * live workspace has no agent; inject fails loudly and the cloud dispatches a
 * cold start instead. There is no zellij path to fall back to.
 */
import { executor } from "@/lib/agent-execution";
import { provisionAgentWorkspace } from "@/lib/agent-execution/launch";
import type { AgentOption } from "@/lib/agent-registry";
import { missingAgentReason } from "@/lib/agents/launch-check";
import { ensureGrokWorkspaceTrusted } from "./grok-prep";
import { fetchWorkspaceSource, repoTokenEnv } from "./workspace-source";
import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";
import { EXIT_SETTLE_MS, forgetTab, rememberTab } from "./tab-memory";
import { stripReportResidue, stripTerminalReports } from "@/lib/terminal-reports";
import { promptAcceptedEvidence, WORKING_MARKERS } from "@/lib/prompt-evidence";

const agentByTab = new Map<string, AgentOption>();
/** The directory each tab's agent was actually launched in (after box
 *  workspace resolution) — where Claude Code writes its session log. */
const dirByTab = new Map<string, string>();
/** The exit watch on each tab's current PTY (tab-memory). */
const exitWatch = new Map<string, () => void>();

/** The launch cwd of this tab's live agent, or null when none was launched. */
export function ptyDirForTab(tab: string): string | null {
  return dirByTab.get(tab.toLowerCase()) ?? null;
}

/**
 * Stable runner-local workspace id for a project tab. The runner has no server
 * userId locally, so it keys by tab; the cloud stream relay namespaces by the
 * runner's bearer token (→ userId) server-side.
 */
export function runnerWorkspaceId(tab: string): string {
  return `runner:${tab.toLowerCase()}`;
}

/** True when this tab is driven by a live Loki-owned PTY. */
export function isPtyBacked(tab: string): boolean {
  const handle = executor.get(runnerWorkspaceId(tab));
  return !!handle && handle.status !== "exited";
}

/**
 * The owned PTY's retained output as a single string, or null if no owned PTY.
 * Pure in-memory (executor.subscribe replays the ring buffer synchronously),
 * so it never blocks the event loop — unlike a zellij dump-screen. Used by the
 * one-shot peek so it shows the agent, not an empty/blocking zellij snapshot.
 */
export function peekPtyBuffer(tab: string): string | null {
  if (!isPtyBacked(tab)) return null;
  let buf = "";
  const unsub = executor.subscribe(runnerWorkspaceId(tab), 0, (e) => {
    if (e.kind === "output" && e.data) buf += e.data;
  });
  unsub();
  return buf;
}

/** Provision (or re-attach to) the agent's PTY. Idempotent per tab. */
export async function launchAgentPty(
  tab: string,
  dir: string,
  agent: AgentOption,
  model?: string,
  sessionId?: string,
  /** Continue the newest Claude conversation in the folder (Resume). */
  resumeLatest = false,
  /** A new run: start the box checkout on a fresh branch off the default. */
  opts: { runId?: string } = {},
): Promise<void> {
  // Refuse a CLI this builder does not have before opening a terminal for it:
  // otherwise the shell says "command not found" and the run reads as an agent
  // that never answered.
  const presence = (process.env.LOKI_RUNNER_PRESENCE_CHANNEL ?? "local").trim();
  const missing = missingAgentReason(
    agent,
    presence === "cloud" || presence === "local" ? presence : null,
  );
  if (missing) throw new Error(missing);
  let effectiveDir = dir;
  // Box-runner: the dispatch's dir is the LAPTOP path and won't exist here.
  // Resolve a box-local workspace (clone-on-demand + pre-trust for claude)
  // before provisioning. What to clone, and the token for it, come from the
  // control plane for THIS runner's account (workspace-source.ts); the same
  // token is the run's own GITHUB_TOKEN. Dynamic import keeps git out of the
  // desktop bundle — only the box-runner sets this env.
  let runEnv: Record<string, string> = {};
  if (process.env.LOKI_BOX_PREPARE === "true") {
    try {
      const { ensureBoxWorkspace, startRunBranch } = await import(
        "@/lib/agent-execution/box-workspace"
      );
      const source = await fetchWorkspaceSource(tab);
      runEnv = repoTokenEnv(source);
      effectiveDir = await ensureBoxWorkspace(tab, dir, source);
      if (opts.runId) {
        const branch = startRunBranch(effectiveDir, opts.runId, source?.token ?? null);
        if (branch) console.log(`[box-prepare] ${tab}: run ${opts.runId} starts on ${branch}`);
      }
    } catch (e) {
      console.error(`[box-prepare] ${tab}: ${e instanceof Error ? e.message : String(e)}`);
      // Fall through with the requested dir; provision will surface the failure.
    }
  }
  // Unattended-launch prep for claude on EVERY runner (not just the box):
  // pre-trust the workspace and merge the unattended allowlist so a dispatched
  // agent can never hang on a trust dialog or an out-of-cwd permission ask
  // (e.g. the final session-handoff write to ~/.loki/sessions/<tab>.md) —
  // with nobody at the PTY, an unanswered prompt is a dead run. Pure fs, no
  // dotfiles or hand-tuned settings required on the user's machine.
  if (agent === "claude") {
    try {
      const { ensureClaudeReady } = await import("@/lib/agent-execution/claude-prep");
      ensureClaudeReady(effectiveDir);
    } catch (e) {
      console.warn(`[claude-prep] ${tab}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (agent === "grok") {
    try {
      ensureGrokWorkspaceTrusted(effectiveDir);
    } catch (e) {
      console.warn(`[grok-prep] ${tab}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Resume: the folder's newest Claude conversation, found where it is
  // written — after the box workspace resolved, since that is the folder
  // Claude Code keyed its log by. None yet: a fresh session, not an error.
  if (resumeLatest && !sessionId && agent === "claude") {
    const { newestLog } = await import("./transcript-streamer");
    const log = await newestLog(effectiveDir).catch(() => null);
    sessionId = log ? log.file.split("/").pop()?.replace(/\.jsonl$/, "") : undefined;
  }
  await provisionAgentWorkspace("runner", {
    projectKey: tab,
    dir: effectiveDir,
    agent,
    model,
    sessionId,
    // Agents that find their own newest conversation (Codex).
    resumeLatest: resumeLatest && agent !== "claude",
    ...(Object.keys(runEnv).length ? { env: runEnv } : {}),
    workspaceId: runnerWorkspaceId(tab),
  });
  agentByTab.set(tab, agent);
  dirByTab.set(tab.toLowerCase(), effectiveDir);
  // Written down so a builder restart reopens it (tab-memory). Crossed off
  // only when the agent exits AND the builder is still here a moment later:
  // a restart ends both at once, and that is not the session ending.
  const gen = rememberTab({ tab, dir: effectiveDir, agent });
  exitWatch.get(tab.toLowerCase())?.();
  exitWatch.set(
    tab.toLowerCase(),
    executor.subscribe(runnerWorkspaceId(tab), 0, (e) => {
      if (e.kind !== "exit") return;
      setTimeout(() => forgetTab(tab, gen), EXIT_SETTLE_MS).unref();
    }),
  );
}

export function ptyAgentForTab(tab: string): AgentOption | null {
  return agentByTab.get(tab) ?? null;
}

export function shouldReplacePtyAgent(
  current: AgentOption | null,
  requested: AgentOption,
): boolean {
  return current !== null && current !== requested;
}

/**
 * Write a prompt into the agent's PTY stdin and submit it.
 *
 * Claude Code's TUI treats a large multi-line write as a bracketed paste and
 * renders it as "[Pasted text +N lines]" WITHOUT submitting — a trailing CR in
 * the same write gets absorbed into the paste buffer as content, not Enter. So
 * the prompt sits in the input and the agent never "picks it up". (Observed
 * live driving kivvi: 59-line next-best template stuck in `-- INSERT --`.)
 *
 * Fix: write the body, then send the submit CR as a SEPARATE keystroke after a
 * short settle so the TUI registers it as Enter rather than paste content. A
 * second nudged CR covers TUIs that need an extra beat after a big paste. Safe
 * for short single-line prompts too (the extra CRs are harmless no-ops at an
 * empty prompt).
 */
export function injectPty(tab: string, text: string): void {
  const id = runnerWorkspaceId(tab);
  const body = text.replace(/[\r\n]+$/, "");
  // Explicit bracketed paste (ESC[200~ … ESC[201~): the TUI ingests the whole
  // blob as ONE atomic paste event. Without the markers, a big dispatch
  // prompt (RAG context blocks) was still being ingested when the fixed-delay
  // CRs below arrived — they were swallowed as in-paste newlines and the
  // prompt sat in the composer unsubmitted (2026-07-02, all six box
  // dispatches). Modern TUIs (Claude Code/Ink, readline ≥ bash 5.1) treat a
  // CR AFTER the end marker as a real keypress: submit.
  executor.write(id, `\x1b[200~${body}\x1b[201~`);
  setTimeout(() => executor.write(id, "\r"), 250);
  setTimeout(() => executor.write(id, "\r"), 800);
}

/**
 * True when the owned PTY is actively generating (status "running"). Used to
 * verify a dispatch landed: a submitted prompt keeps the agent generating,
 * while a paste that never submitted falls quiet → "idle" after IDLE_MS.
 */
export function isPtyBusy(tab: string): boolean {
  return executor.get(runnerWorkspaceId(tab))?.status === "running";
}

/**
 * Observe output produced after a prompt is submitted.
 *
 * Sampling `isPtyBusy` once at the end of an eight-second window loses real
 * agents: Grok alternates between short output bursts and quiet inference, so
 * a run can be visibly working in Terminal at second seven and read idle at
 * second eight. Subscribe before injection and remember any later output.
 */
export function waitForPtyOutput(
  tab: string,
  timeoutMs = 8000,
  opts: { agent?: AgentOption; prompt?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const id = runnerWorkspaceId(tab);
    let replaying = true;
    let settled = false;
    let raw = "";
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(value);
    };
    const unsub = executor.subscribe(id, 0, (event) => {
      if (replaying || event.kind !== "output" || !event.data) return;
      raw += event.data;
      // Byte volume is not evidence: a composer redrawing `1;2c1;2c…` (viewer
      // DA answers) or the echo of our own paste produces plenty of bytes
      // while the prompt sits unsubmitted (Substrata on Antigravity,
      // 2026-10-21: "Agent is working" for 14 minutes, nothing ran).
      if (promptAcceptedEvidence(raw, opts.agent ?? null, opts.prompt ?? "")) finish(true);
    });
    replaying = false;
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Resolve when the agent's composer is on screen, so the paste lands in the
 * input and not in a boot banner, trust dialog or terminal-capability probe.
 * Agents without a known marker resolve at once (the caller already waited for
 * first output).
 */
const COMPOSER_MARKERS: Partial<Record<AgentOption, RegExp>> = {
  gemini: /type your message/i,
};

export function waitForAgentComposer(
  tab: string,
  agent: AgentOption,
  maxWaitMs = 30000,
): Promise<boolean> {
  const marker = COMPOSER_MARKERS[agent];
  if (!marker) return Promise.resolve(true);
  const seen = () => marker.test(stripReportResidue((peekPtyBuffer(tab) ?? "").replace(ANSI_RE, "")));
  if (seen()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (seen()) {
        clearInterval(tick);
        resolve(true);
      } else if (Date.now() - started > maxWaitMs) {
        clearInterval(tick);
        resolve(false);
      }
    }, 250);
  });
}

/** Turn a silent PTY into a cause and a concrete recovery action. */
export function explainPtyDispatchFailure(tab: string, agent: AgentOption): string {
  const screen = peekPtyBuffer(tab)?.toLowerCase() ?? "";
  const capacity = capacityFailureFromScreen(screen, agent);
  if (capacity) return capacity;
  if (/do you trust|trust (?:this|the) (?:directory|folder|workspace)/.test(screen)) {
    return `${agent} is waiting for workspace trust, so it consumed the prompt before the agent was ready. Open Terminal, approve this folder once, then Retry.`;
  }
  if (/not (?:logged|signed) in|login required|authentication required|unauthorized|\b401\b/.test(screen)) {
    return `${agent} is not logged in on this computer. Open Terminal, run ${agent === "cursor" ? "cursor-agent login" : `${agent} login`}, then Retry.`;
  }
  const seen = screenExcerpt(peekPtyBuffer(tab) ?? "");
  if (WORKING_MARKERS[agent]) {
    return (
      `${agentLabel(agent)} never accepted the prompt: Loki submitted it but the CLI never started working on it. Loki moves the run to the next AI provider; to keep ${agentLabel(agent)}, open Terminal to see its screen, then Retry.` +
      (seen ? ` Its screen ended with: “${seen}”` : "")
    );
  }
  return (
    `${agent} opened on this computer, but produced no response after Loki submitted the prompt. Open Terminal to see the live CLI; if it is idle, choose another AI provider and Retry.` +
    (seen ? ` Its screen ended with: “${seen}”` : "")
  );
}

/**
 * The last few lines the CLI actually drew, as one short quote — so a failure
 * that names no known cause still says what the agent was showing, instead of
 * leaving the person to guess (Petvity, 2026-09-28: "produced no response"
 * twice, while Claude was logged in and far from any limit).
 */
export function screenExcerpt(raw: string, maxLines = 6, maxChars = 320): string {
  const lines = raw
    .replace(ANSI_RE, "")
    .split(/\r?\n|\r/)
    .map((line) => line.replace(/[─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1);
  const tail = lines.slice(-maxLines).join(" / ");
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

const agentLabel = (agent: AgentOption) => (agent === "gemini" ? "Antigravity" : agent);

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const normalizeScreenText = (s: string) => s.replace(ANSI_RE, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A CLI quota wall redraws the terminal, so output volume alone cannot prove
 * generation. Convert the provider's own screen into an exact blocker before
 * the runner acknowledges `generating`.
 *
 * `prompt` is what Loki just injected. The CLI echoes it, and a task ABOUT
 * rate limits, credits or context windows is not a quota wall: on 2026-09-25
 * a Skif brief asking the agent to adopt limitkit was NACKed as "usage limit
 * exhausted" while Claude was visibly working on it. A line of the screen that
 * is only a piece of the prompt is ignored; the wall has to be something the
 * CLI said. */
export function capacityFailureFromScreen(
  screen: string,
  agent: AgentOption,
  prompt?: string,
): string | null {
  const echoed = prompt ? normalizeScreenText(prompt) : "";
  const said = screen
    .replace(ANSI_RE, "")
    .split(/\r?\n|\r/)
    .map(normalizeScreenText)
    // Box-drawing borders and the composer's "> " marker wrap an echoed prompt.
    .map((line) => line.replace(/^[\s>│┃|]+|[\s│┃|]+$/g, ""))
    .filter((line) => line && looksLikeAgentCapacityIssue(line))
    .filter((line) => !(echoed && echoed.includes(line)));
  if (!said.length) return null;
  return `${agent} cannot generate because its usage limit is exhausted. Switch this project to a provider with available capacity, then Retry.`;
}

/**
 * Collect what the PTY prints from NOW on. Start it before injecting: a quota
 * wall is the CLI's answer to the prompt, so only output after the injection
 * can be one. Scanning the whole buffer read the boot banner, the previous
 * turn and the agent's own `cat` of a file mentioning "credit" as a wall.
 */
export function startPtyOutputCapture(tab: string): { text: () => string; stop: () => void } {
  let replaying = true;
  let buf = "";
  const unsub = executor.subscribe(runnerWorkspaceId(tab), 0, (e) => {
    if (!replaying && e.kind === "output" && e.data) buf += e.data;
  });
  replaying = false;
  return { text: () => buf, stop: unsub };
}

export function detectPtyCapacityFailure(
  tab: string,
  agent: AgentOption,
  opts: { since?: string; prompt?: string } = {},
): string | null {
  return capacityFailureFromScreen(opts.since ?? peekPtyBuffer(tab) ?? "", agent, opts.prompt);
}

/**
 * Write raw terminal keystroke bytes into the agent's PTY, VERBATIM — no CR
 * append, no settle delays, no prompt-state side effects (unlike injectPty).
 * This is the interactive-terminal fast lane (Ctrl-C, arrows, Tab, etc.).
 * No-ops if the tab has no live owned PTY — a stray key for a dead tab is
 * harmless, mirroring executor.write's own guard.
 */
export function writeRawKey(tab: string, bytes: string): void {
  if (!isPtyBacked(tab)) return;
  // A viewer's answer to a terminal query is not a key (terminal-reports.ts).
  const keys = stripTerminalReports(bytes);
  if (keys) executor.write(runnerWorkspaceId(tab), keys);
}

/** Resize the agent's PTY (interactive terminal fit). No-ops without a live PTY. */
export function resizePty(tab: string, cols: number, rows: number): void {
  if (!isPtyBacked(tab)) return;
  executor.resize(runnerWorkspaceId(tab), cols, rows);
}

/** Kill the agent's PTY and release the workspace. */
export async function terminatePty(tab: string): Promise<void> {
  // Closed on purpose: it must not come back after the next restart.
  forgetTab(tab);
  await executor.terminate(runnerWorkspaceId(tab));
  agentByTab.delete(tab);
}

/** Tabs currently backed by a live owned PTY (for the heartbeat's open-tabs). */
export function listPtyTabs(): string[] {
  const prefix = "runner:";
  return executor
    .list()
    .filter((h) => h.status !== "exited" && h.id.startsWith(prefix))
    .map((h) => h.id.slice(prefix.length));
}

/**
 * Resolve once the agent shows life (first running/idle event) so a paste lands
 * in the CLI prompt, not the boot banner. Mirrors the server's settle. Returns
 * false on timeout (caller injects anyway / retries).
 */
export function waitForPtyReady(tab: string, maxWaitMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    const id = runnerWorkspaceId(tab);
    const cur = executor.get(id);
    if (cur && (cur.status === "running" || cur.status === "idle")) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      resolve(v);
    };
    const unsub = executor.subscribe(id, 0, (e) => {
      if (e.kind === "status" && (e.status === "running" || e.status === "idle")) finish(true);
    });
    const timer = setTimeout(() => finish(false), maxWaitMs);
  });
}
