import { isWorkbenchPaneId } from "@/lib/workbench/layout";
import type { WorkbenchPaneId } from "@/config/workbench";

/**
 * What the workbench's windows tell each other, on one machine.
 *
 * A pane popped out to its own window says so, and the window it left stops
 * drawing it; when that window closes, the pane comes back. Two screens are
 * one browser, so a BroadcastChannel per project is the whole transport —
 * nothing crosses the network for an arrangement of windows. Another device
 * shares the project's STATE through the server, as every page does, and
 * never its window layout.
 *
 * Pure parts (the message shape) are tested in scripts/test/workbench-windows.ts.
 */
export type WorkbenchBusMessage = {
  kind: "pane";
  pane: WorkbenchPaneId;
  state: "open" | "closed";
  /** The window that said it, so a window ignores its own announcements. */
  from: string;
};

export function parseBusMessage(data: unknown): WorkbenchBusMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Partial<WorkbenchBusMessage>;
  if (m.kind !== "pane") return null;
  if (!isWorkbenchPaneId(m.pane)) return null;
  if (m.state !== "open" && m.state !== "closed") return null;
  if (typeof m.from !== "string" || !m.from) return null;
  return { kind: "pane", pane: m.pane, state: m.state, from: m.from };
}

export function workbenchChannelName(projectId: string): string {
  return `loki:workbench:${projectId}`;
}

export type WorkbenchBus = {
  post: (message: WorkbenchBusMessage) => void;
  subscribe: (listener: (message: WorkbenchBusMessage) => void) => () => void;
  close: () => void;
};

/** A bus for this project in this browser; inert where BroadcastChannel is missing. */
export function createWorkbenchBus(projectId: string): WorkbenchBus {
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => undefined, subscribe: () => () => undefined, close: () => undefined };
  }
  const channel = new BroadcastChannel(workbenchChannelName(projectId));
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (listener) => {
      const handler = (event: MessageEvent) => {
        const message = parseBusMessage(event.data);
        if (message) listener(message);
      };
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
    close: () => channel.close(),
  };
}
