/**
 * The floating assistant's transcript, kept on the device per person and per
 * project.
 *
 * The panel used to hold its turns in React state only: a navigation emptied
 * it, and the one place the operator asks about the page they are on forgot
 * everything between pages. Agreed in the 2026-10-31 dogfooding round, with
 * the objection that shaped it: one shared thread would carry project A's
 * context into project B's answers, so the key is the person AND the scope,
 * and a project page shows that project's thread only. The same pattern as
 * lib/loki/draft.ts, which is why this is not chatkit's conversation store —
 * that one keeps a list of named chats, and this panel has exactly one per
 * scope.
 */
const PREFIX = "loki:ask:";
/** Fleet-wide pages share one thread; a project page has its own. */
export const FLEET_SCOPE = "fleet";
/** The most turns kept per thread. The ask sends the last eight anyway. */
export const PANEL_THREAD_LIMIT = 24;

export type PanelTurn = {
  role: "user" | "loki";
  text: string;
  meta?: Record<string, unknown>;
  replies?: string[];
  buildLine?: string | null;
};

export function panelThreadKey(viewerId: string | null, projectKey: string | null): string {
  return `${PREFIX}${viewerId ?? "anon"}:${projectKey ?? FLEET_SCOPE}`;
}

export function readPanelThread(key: string): PanelTurn[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is PanelTurn =>
        !!t &&
        typeof t === "object" &&
        ((t as PanelTurn).role === "user" || (t as PanelTurn).role === "loki") &&
        typeof (t as PanelTurn).text === "string",
    );
  } catch {
    return [];
  }
}

export function writePanelThread(key: string, turns: readonly PanelTurn[]): void {
  try {
    if (turns.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(turns.slice(-PANEL_THREAD_LIMIT)));
  } catch {
    /* storage unavailable — the in-memory thread still works */
  }
}

export function clearPanelThread(key: string): void {
  writePanelThread(key, []);
}
