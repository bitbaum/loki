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

/** Fire-and-forget JSON POST. Transient failure is fine: the output stream stays
 *  the source of truth and a dropped keystroke is re-typed — so this swallows
 *  the rejection the shared wrapper would otherwise leave unhandled. */
const post = (url: string, body: unknown): Promise<void> =>
  postJson(url, body)
    .then(() => undefined)
    .catch(() => undefined);

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
    sendResize: (cols, rows) => void post(base, { action: "resize", cols, rows }),
  };
}

/**
 * Fleet Runner machine PTY, viewed via the peek stream — raw-PTY bytes when the
 * agent runs in a Loki-owned PTY (append frames), snapshots otherwise
 * (reset+repaint frames). Input/resize ride the rawkey fast
 * lane (/api/control/tab-inject-raw → bridge → runner PTY).
 */
export function runnerTransport(tab: string, channel?: BuilderChannel): TerminalTransport {
  const ch = channel ?? undefined;
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
          const { frame, append } = JSON.parse(e.data) as { frame: string; append?: boolean };
          if (!append) h.onReset(); // Snapshot → clear, then repaint the full screen.
          h.onOutput(frame);
        } catch {
          /* ignore malformed frame */
        }
      });
      es.onerror = () => h.onConnected(false);
      return () => es.close();
    },
    sendKey: (data) =>
      post("/api/control/tab-inject-raw", {
        kind: "key",
        tab,
        data,
        ...(ch ? { channel: ch } : {}),
      }),
    sendResize: (cols, rows) =>
      void post("/api/control/tab-inject-raw", {
        kind: "resize",
        tab,
        cols,
        rows,
        ...(ch ? { channel: ch } : {}),
      }),
  };
}
