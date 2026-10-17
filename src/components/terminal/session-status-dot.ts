import type { SessionStatus } from "@/lib/terminal-session-status";

/**
 * One dot per session, the same on the phone's row and the desktop strip:
 * a pulse while it works, amber when it waits on you, green when it finished,
 * grey when it is just open. Colour is never the only signal — every tab also
 * says its status in words to screen readers and in its tooltip.
 */
export const SESSION_STATUS_DOT: Record<SessionStatus, string> = {
  working: "ui-term-live-dot ui-term-status-working",
  "needs-you": "ui-term-live-dot ui-term-live-dot-warn",
  done: "ui-term-live-dot ui-term-live-dot-on",
  idle: "ui-term-live-dot",
};
