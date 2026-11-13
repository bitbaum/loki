/**
 * The half of an Executor that has nothing to do with where the process runs.
 *
 * LocalPtyExecutor and SandboxExecutor differ in exactly two places — how the
 * PTY is spawned, and what terminate() has to clean up afterwards. Everything
 * else (the workspace map, the ring buffer, sequence numbers, replay on
 * reconnect, the running→idle timer, listener isolation) was 74 lines copied
 * verbatim between them.
 *
 * Copied is the wrong word for what that costs: the two copies had already
 * drifted in their comments, and the next fix to the event stream would have
 * landed in one substrate and not the other — a bug you can only see by
 * switching LOKI_EXECUTOR. The seam belongs here, where "both backends behave
 * identically" is a fact about the code rather than a claim about two files.
 *
 * A third substrate implements `launch` and, if it owns anything outside the
 * PTY, `afterTerminate`. That is the whole contract.
 */
import type { IPty } from "node-pty";
import type {
  AgentEvent,
  AgentLifecycle,
  EventListener,
  Executor,
  Unsubscribe,
  WorkspaceHandle,
  WorkspaceId,
  WorkspaceSpec,
} from "./types";

/** Quiet period after which a workspace flips running -> idle (≈ "awaiting input"). */
export const IDLE_MS = 1500;

/** Retained events per workspace for reconnect replay (ring buffer). */
export const MAX_BUFFERED_EVENTS = 5000;

/** `meta` is whatever the backend needs to remember about a live workspace
 *  (SandboxExecutor keeps the container name; LocalPtyExecutor needs nothing). */
export interface PtyWorkspaceState<M> {
  handle: WorkspaceHandle;
  pty: IPty | null; // null once exited
  buffer: AgentEvent[]; // ring buffer, trimmed to MAX_BUFFERED_EVENTS
  seq: number;
  listeners: Set<EventListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  meta: M;
}

export abstract class PtyExecutor<M = undefined> implements Executor {
  protected workspaces = new Map<WorkspaceId, PtyWorkspaceState<M>>();

  /** Start the process for `spec`. Throw to refuse provisioning. */
  protected abstract launch(spec: WorkspaceSpec): Promise<{ pty: IPty; meta: M }>;

  /** Clean up anything the backend owns outside the PTY. Called after the PTY
   *  is killed and the workspace is marked exited. Best effort by contract. */
  protected async afterTerminate(_state: PtyWorkspaceState<M>): Promise<void> {}

  async provision(spec: WorkspaceSpec): Promise<WorkspaceHandle> {
    const existing = this.workspaces.get(spec.id);
    if (existing && existing.handle.status !== "exited") return existing.handle;

    const { pty, meta } = await this.launch(spec);

    const state: PtyWorkspaceState<M> = {
      handle: {
        id: spec.id,
        status: "starting",
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
      pty,
      buffer: [],
      seq: 0,
      listeners: new Set(),
      idleTimer: null,
      meta,
    };
    this.workspaces.set(spec.id, state);

    pty.onData((data) => {
      state.handle.lastActivityAt = Date.now();
      this.setStatus(state, "running");
      this.emit(state, { kind: "output", data });
      this.armIdle(state);
    });

    pty.onExit(({ exitCode }) => {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.idleTimer = null;
      state.pty = null;
      state.handle = { ...state.handle, status: "exited" };
      this.emit(state, { kind: "status", status: "exited" });
      this.emit(state, { kind: "exit", exitCode });
    });

    return state.handle;
  }

  write(id: WorkspaceId, data: string): void {
    const state = this.workspaces.get(id);
    if (!state?.pty) return;
    state.handle.lastActivityAt = Date.now();
    state.pty.write(data);
  }

  resize(id: WorkspaceId, cols: number, rows: number): void {
    const state = this.workspaces.get(id);
    if (state?.pty) {
      try {
        state.pty.resize(cols, rows);
      } catch {
        /* pty may have just exited */
      }
    }
  }

  subscribe(id: WorkspaceId, sinceSeq: number, listener: EventListener): Unsubscribe {
    const state = this.workspaces.get(id);
    if (!state) return () => {};
    // Replay retained history first so a (re)connecting client catches up.
    for (const event of state.buffer) {
      if (event.seq > sinceSeq) listener(event);
    }
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  get(id: WorkspaceId): WorkspaceHandle | null {
    return this.workspaces.get(id)?.handle ?? null;
  }

  list(): WorkspaceHandle[] {
    return [...this.workspaces.values()].map((s) => s.handle);
  }

  async terminate(id: WorkspaceId): Promise<void> {
    const state = this.workspaces.get(id);
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    try {
      state.pty?.kill();
    } catch {
      /* already dead */
    }
    state.pty = null;
    // Mark exited synchronously. pty.onExit may not fire for a beat, and a
    // re-provision of the same id (e.g. switching agents) must spawn fresh —
    // provision() returns the existing handle unless its status is "exited".
    if (state.handle.status !== "exited") {
      state.handle = { ...state.handle, status: "exited" };
      this.emit(state, { kind: "status", status: "exited" });
    }
    await this.afterTerminate(state);
  }

  // --- internals ---

  protected emit(
    state: PtyWorkspaceState<M>,
    partial: Omit<AgentEvent, "workspaceId" | "seq" | "at">,
  ): void {
    const event: AgentEvent = {
      workspaceId: state.handle.id,
      seq: ++state.seq,
      at: Date.now(),
      ...partial,
    };
    state.buffer.push(event);
    if (state.buffer.length > MAX_BUFFERED_EVENTS) {
      state.buffer.splice(0, state.buffer.length - MAX_BUFFERED_EVENTS);
    }
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch {
        /* a bad listener must not break the stream */
      }
    }
  }

  protected setStatus(state: PtyWorkspaceState<M>, status: AgentLifecycle): void {
    if (state.handle.status === status || state.handle.status === "exited") return;
    state.handle = { ...state.handle, status };
    this.emit(state, { kind: "status", status });
  }

  protected armIdle(state: PtyWorkspaceState<M>): void {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => this.setStatus(state, "idle"), IDLE_MS);
  }
}
