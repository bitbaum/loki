/**
 * The Executor abstraction — the SSOT for "run an agent, write to it, read it,
 * observe it." See docs/architecture/agent-execution-platform.md.
 *
 * Terminal-agnostic BY CONSTRUCTION: it traffics in a stable id, raw PTY bytes,
 * and structured events — never a zellij session/tab name. The same interface is
 * satisfied by LocalPtyExecutor (dev/self-host, here) and SandboxExecutor
 * (Docker today; Firecracker/gVisor/K8s/Fly/e2b later) with zero changes to
 * the control plane or the UI. The interface is intentionally minimal — it is
 * defined BY its first real implementation (LocalPty) rather than guessed, and
 * grows only as a concrete executor needs it (snapshot/restore arrive with the
 * SandboxExecutor that can actually hibernate).
 */

/** A stable, Loki-assigned workspace id. Never a terminal/session name. */
export type WorkspaceId = string;

export type AgentLifecycle = "starting" | "running" | "idle" | "exited";

export interface WorkspaceSpec {
  /** Stable id the caller owns (e.g. `${userId}:${projectKey}` or a uuid). */
  id: WorkspaceId;
  /** Working directory the agent runs in. */
  cwd: string;
  /** Executable to launch (e.g. "claude", "grok", "bash"). */
  command: string;
  /** Arguments (e.g. ["--model", "opus"]). */
  args?: string[];
  /** Extra environment for the agent process. */
  env?: Record<string, string>;
  /** A plain shell (lib/shell-session.ts), not an agent: no engine keys in its
   *  environment. */
  plainShell?: boolean;
  /** Initial PTY size. */
  cols?: number;
  rows?: number;
}

/**
 * One event in a workspace's stream. `seq` is monotonic per workspace so a
 * reconnecting client can resume exactly where it left off (the connection
 * plane replays from `sinceSeq`). This is the event-sourced SSOT for status —
 * no /proc scans, no /tmp sentinels, no screen-scraping.
 */
export interface AgentEvent {
  workspaceId: WorkspaceId;
  seq: number;
  at: number; // epoch ms
  kind: "output" | "status" | "exit";
  /** kind="output": raw PTY bytes as a utf-8 string. */
  data?: string;
  /** kind="status": the new lifecycle state. */
  status?: AgentLifecycle;
  /** kind="exit": process exit code (null if killed by signal). */
  exitCode?: number | null;
}

export interface WorkspaceHandle {
  id: WorkspaceId;
  status: AgentLifecycle;
  startedAt: number; // epoch ms
}

export type EventListener = (event: AgentEvent) => void;
export type Unsubscribe = () => void;

export interface Executor {
  /** Spawn the agent in a Loki-owned PTY. Idempotent per id: re-provisioning
   *  a live workspace returns the existing handle. */
  provision(spec: WorkspaceSpec): Promise<WorkspaceHandle>;

  /** Write bytes to the agent's stdin (a typed prompt, a keystroke, an interrupt). */
  write(id: WorkspaceId, data: string): void;

  /** Resize the PTY (browser xterm reflow). */
  resize(id: WorkspaceId, cols: number, rows: number): void;

  /** Subscribe to the workspace's event stream, replaying everything with
   *  seq > sinceSeq first (pass 0 for the full retained buffer). Returns an
   *  unsubscribe fn. */
  subscribe(id: WorkspaceId, sinceSeq: number, listener: EventListener): Unsubscribe;

  /** Current handle, or null if no such workspace. */
  get(id: WorkspaceId): WorkspaceHandle | null;

  /** All live workspaces this executor owns. */
  list(): WorkspaceHandle[];

  /** Kill the agent and release its PTY. */
  terminate(id: WorkspaceId): Promise<void>;
}
