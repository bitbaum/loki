/**
 * Terminal transport — the SSOT seam between the ONE xterm view (TerminalView)
 * and the two substrates it can drive. "Same xterm view, two substrates" made
 * literal: the component owns rendering, input buffering, fit/resize and chrome;
 * the transport owns I/O (which endpoints, which message shapes, which stream
 * protocol). Add a third substrate (e.g. a SandboxExecutor over WebSocket) by
 * writing a third factory — the view never changes.
 */
import type { AgentEvent, AgentLifecycle } from "@/lib/agent-execution/types";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { postJson } from "@/lib/api/fetch";

export interface TerminalStreamHandlers {
  /** Append bytes to the screen (a true byte delta). */
  onOutput: (data: string) => void;
  /** Clear the screen before the next write — full-screen repaint (snapshot mode). */
  onReset: () => void;
  /** Agent lifecycle changed (workspace substrate only emits these). */
  onStatus: (status: AgentLifecycle) => void;
  /** Stream connection state, for the "connecting…/live" indicator. */
  onConnected: (connected: boolean) => void;
  /** Called before each frame: true for the server's remembered copy of the
   *  last screen (shown at once, not yet live), false for a live frame. */
  onCached?: (cached: boolean) => void;
}

export interface TerminalTransport {
  /** Stable identity (the workspace id or tab) — TerminalView keys its connect
   *  effect on this so a re-render with a fresh transport object doesn't tear
   *  down and rebuild the stream. */
  readonly key: string;
  /** xterm needs \n→\r\n conversion for line-oriented snapshot streams; a raw
   *  PTY byte stream already carries \r\n, so it sets this false. */
  readonly convertEol: boolean;
  /** Open the output stream. Returns a cleanup fn. */
  connect: (handlers: TerminalStreamHandlers) => () => void;
  /** Send verbatim keystroke bytes. Awaited by the buffer drain so order holds. */
  sendKey: (data: string) => Promise<void>;
  /** Send a resize. */
  sendResize: (cols: number, rows: number) => void;
}

/** A write the server refused; `status` 403 on a shell means it locked. */
export class SessionInputError extends Error {
  constructor(readonly status: number) {
    super(`Session input failed (HTTP ${status})`);
  }
}

/** Input callers must know when a message did not reach the session. */
const post = async (url: string, body: unknown): Promise<void> => {
  const response = await postJson(url, body);
  if (!response.ok) throw new SessionInputError(response.status);
};

/**
 * Loki server-owned PTY (LocalPtyExecutor / SandboxExecutor) — real PTY
 * bytes over /api/workspaces/[id], resumable SSE on /stream. Input/resize POST
 * back to the same id.
 */
export function workspaceTransport(id: string): TerminalTransport {
  const base = `/api/workspaces/${encodeURIComponent(id)}`;
  return {
    key: `ws:${id}`,
    convertEol: false,
    connect: (h) => {
      const source = new EventSource(`${base}/stream`);
      source.onopen = () => h.onConnected(true);
      source.onerror = () => h.onConnected(false);
      source.onmessage = (msg) => {
        let event: AgentEvent;
        try {
          event = JSON.parse(msg.data) as AgentEvent;
        } catch {
          return;
        }
        if (event.kind === "output" && event.data) h.onOutput(event.data);
        else if (event.kind === "status" && event.status) h.onStatus(event.status);
        else if (event.kind === "exit") h.onStatus("exited");
      };
      return () => source.close();
    },
    sendKey: (data) => post(base, { action: "input", data }),
    sendResize: (cols, rows) => void post(base, { action: "resize", cols, rows }).catch(() => {}),
  };
}

/**
 * Fleet Runner machine PTY, viewed via the peek stream — raw-PTY bytes when the
 * agent runs in a Loki-owned PTY (append frames), snapshots otherwise
 * (reset+repaint frames). Input/resize ride the rawkey fast
 * lane (/api/control/tab-inject-raw → bridge → runner PTY).
 */
export function runnerTransport(
  tab: string,
  channel?: BuilderChannel,
  /** A plain shell passes this: the server said the shell is locked (the stream
   *  ended on idle, a keystroke was refused, the stream could not open). The
   *  screen re-asks the server and shows the PIN form if so. */
  onLocked?: () => void,
): TerminalTransport {
  const ch = channel ?? undefined;
  const guarded = async (send: () => Promise<void>) => {
    try {
      await send();
    } catch (e) {
      if (onLocked && e instanceof SessionInputError && e.status === 403) onLocked();
      throw e;
    }
  };
  return {
    key: `runner:${channel ?? "any"}:${tab}`,
    convertEol: true,
    connect: (h) => {
      const params = new URLSearchParams({ tab });
      if (ch) params.set("channel", ch);
      const es = new EventSource(`/api/control/peek-stream?${params.toString()}`);
      es.addEventListener("ready", () => h.onConnected(true));
      es.addEventListener("frame", (e: MessageEvent) => {
        try {
          const { frame, append, cached } = JSON.parse(e.data) as {
            frame: string;
            append?: boolean;
            cached?: boolean;
          };
          h.onCached?.(cached === true);
          if (!append) h.onReset(); // Snapshot → clear, then repaint the full screen.
          h.onOutput(frame);
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("locked", () => {
        h.onConnected(false);
        es.close();
        onLocked?.();
      });
      es.onerror = () => {
        h.onConnected(false);
        onLocked?.();
      };
      return () => es.close();
    },
    sendKey: (data) =>
      guarded(() =>
        post("/api/control/tab-inject-raw", {
          kind: "key",
          tab,
          data,
          ...(ch ? { channel: ch } : {}),
        }),
      ),
    sendResize: (cols, rows) =>
      void post("/api/control/tab-inject-raw", {
        kind: "resize",
        tab,
        cols,
        rows,
        ...(ch ? { channel: ch } : {}),
      }).catch(() => {}),
  };
}
