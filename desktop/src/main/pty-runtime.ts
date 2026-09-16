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
import { ensureGrokWorkspaceTrusted } from "./grok-prep";

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
): Promise<void> {
  let effectiveDir = dir;
  // Box-runner: the dispatch's dir is the LAPTOP path and won't exist here.
  // Resolve a box-local workspace (clone-on-demand + pre-trust for claude)
  // before provisioning. Dynamic import keeps @/db + git out of the desktop
  // bundle — only the box-runner sets this env.
  if (process.env.LOKI_BOX_PREPARE === "true") {
    try {
      const { ensureBoxWorkspace } = await import("@/lib/agent-execution/box-workspace");
      effectiveDir = await ensureBoxWorkspace(tab, dir);
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
  await provisionAgentWorkspace("runner", {
    projectKey: tab,
    dir: effectiveDir,
    agent,
    model,
    sessionId,
    workspaceId: runnerWorkspaceId(tab),
  });
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
export function waitForPtyOutput(tab: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const id = runnerWorkspaceId(tab);
    let replaying = true;
    let settled = false;
    let bytes = 0;
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
      bytes += event.data.length;
      // A submitted prompt causes a redraw even before the first model token.
      // Requiring more than a cursor-control byte filters terminal noise.
      if (bytes >= 64) finish(true);
    });
    replaying = false;
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/** Turn a silent PTY into a cause and a concrete recovery action. */
export function explainPtyDispatchFailure(tab: string, agent: AgentOption): string {
  const screen = peekPtyBuffer(tab)?.toLowerCase() ?? "";
  if (/do you trust|trust (?:this|the) (?:directory|folder|workspace)/.test(screen)) {
    return `${agent} is waiting for workspace trust, so it consumed the prompt before the agent was ready. Open Terminal, approve this folder once, then Retry.`;
  }
  if (/not (?:logged|signed) in|login required|authentication required|unauthorized|\b401\b/.test(screen)) {
    return `${agent} is not logged in on this computer. Open Terminal, run ${agent === "cursor" ? "cursor-agent login" : `${agent} login`}, then Retry.`;
  }
  return `${agent} opened on this computer, but produced no response after Loki submitted the prompt. Open Terminal to see the live CLI; if it is idle, choose another AI provider and Retry.`;
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
  executor.write(runnerWorkspaceId(tab), bytes);
}

/** Resize the agent's PTY (interactive terminal fit). No-ops without a live PTY. */
export function resizePty(tab: string, cols: number, rows: number): void {
  if (!isPtyBacked(tab)) return;
  executor.resize(runnerWorkspaceId(tab), cols, rows);
}

/** Kill the agent's PTY and release the workspace. */
export async function terminatePty(tab: string): Promise<void> {
  await executor.terminate(runnerWorkspaceId(tab));
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
