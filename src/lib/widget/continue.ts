import { fleetSurfaceHref, withTerminalView } from "@/lib/fleet-context";

/** Mirrors ContinueView / HANDOFF_MAX in widget/continue.ts. */
export const CONTINUE_VIEWS = ["chat", "terminal"] as const;
export type ContinueView = (typeof CONTINUE_VIEWS)[number];
export const CONTINUE_TEXT_MAX = 4000;

/**
 * Where "Continue in Loki" lands, inside Loki: the chat on this project with
 * the panel's thread in the composer (nothing is sent until the person
 * presses send — they came to develop the idea, not to fire it), or the
 * project's terminal. Pure, so the route stays a thin check-and-redirect.
 */
export function continueHref(projectKey: string, view: ContinueView, text: string | null): string {
  const base =
    view === "terminal"
      ? withTerminalView(fleetSurfaceHref("terminal", projectKey), "terminal")
      : fleetSurfaceHref("chat", projectKey);
  const q = text?.trim().slice(0, CONTINUE_TEXT_MAX);
  return q ? `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : base;
}
