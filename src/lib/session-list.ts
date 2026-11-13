/**
 * The Sessions list, in words: which projects have their agent open right
 * now, what each is doing, and when the rest last had an agent work on them.
 *
 * It replaced four coloured dots and six codes ("ready", "offline", "open",
 * "closed", "working", "—") on every one of the owner's 42 projects, with an
 * age that was the time a runner last WROTE the row, not the time anyone
 * worked: "aoz-housing · offline · 29d ago" for a project looked at that week
 * (owner, 2026-10-19: "what exactly do you mean by sessions? … random shit").
 * "Offline" meant only "not reported in the last five minutes".
 *
 * Pure: a project_states row in, one row of the list out.
 */

/** The fields of a project_states row this reads. */
export type SessionStateRow = {
  agentRunning: boolean;
  tabOpen: boolean;
  closedAt: Date | null;
  sessionStatus: string | null;
  sessionBlockReason: string | null;
  currentPromptKey: string | null;
  currentPromptLabel: string | null;
  /** When the runner last looked at the session itself. */
  runtimeObservedAt: Date | null;
  /** When the agent last wrote its handoff — the last time it worked. */
  sessionUpdatedAt: Date | null;
  currentPromptStartedAt: Date | null;
  updatedAt: Date;
};

/** What an open session is doing, as the row says it. */
export type OpenStatus = "working" | "waiting" | "finished" | "idle";

export type SessionListRow =
  { open: true; status: OpenStatus; line: string } | { open: false; lastWorkedAt: string | null };

/** A session the runner has not looked at for this long is not open. The
 *  runner reports every open session at least every few minutes. */
export const OPEN_FRESH_MS = 10 * 60_000;

/** "custom", "next_best" — a key, not words; the row says "Working" alone. */
const looksLikeWords = (label: string) => /\s/.test(label.trim());

export function sessionListRow(
  state: SessionStateRow | null | undefined,
  now: number = Date.now(),
): SessionListRow {
  const lastWorked = state
    ? (latest(state.sessionUpdatedAt, state.currentPromptStartedAt) ?? null)
    : null;
  if (!state || state.closedAt) return { open: false, lastWorkedAt: lastWorked };
  const seen = (state.runtimeObservedAt ?? state.updatedAt).getTime();
  const open = (state.agentRunning || state.tabOpen) && now - seen <= OPEN_FRESH_MS;
  if (!open) return { open: false, lastWorkedAt: lastWorked };

  const status = openStatus(state);
  return { open: true, status, line: statusLine(status, state.currentPromptLabel) };
}

function openStatus(state: SessionStateRow): OpenStatus {
  const s = state.sessionStatus?.toLowerCase().trim() ?? "";
  // A turn in progress outranks a handoff that said "blocked": the order
  // Control and the terminal's tabs use (lib/terminal-session-status).
  if (state.currentPromptKey && s !== "ready") return "working";
  if (state.sessionBlockReason || s === "blocked") return "waiting";
  if (s === "working") return "working";
  if (s === "ready") return "finished";
  return "idle";
}

/** One line that says what tapping the row gives you. */
export function statusLine(status: OpenStatus, label?: string | null): string {
  switch (status) {
    case "working":
      return label && looksLikeWords(label) ? `Working on ${clip(label)}` : "Working";
    case "waiting":
      return "Waiting for you";
    case "finished":
      return "Finished — your turn";
    case "idle":
      return "Open, nothing running";
  }
}

function latest(...dates: (Date | null)[]): string | null {
  const times = dates.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function clip(text: string, max = 60): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * "Is anything running, and where do I watch it?" — asked of every page, not
 * only Home (owner, 2026-11-12: "I would like to know if anything is actively
 * running, and I would like to watch it"). The top bar shows it only while an
 * agent is working; the link opens that session when there is one, the
 * terminal's list when there are several.
 */
export function workingNow<T extends { session: SessionListRow; tab: string | null; name: string }>(
  items: readonly T[],
  terminalHref: string,
): { count: number; href: string; label: string } | null {
  const working = items.filter((i) => i.session.open && i.session.status === "working");
  if (working.length === 0) return null;
  const only = working.length === 1 ? working[0]! : null;
  const href = only
    ? only.tab
      ? `${terminalHref}?tab=${encodeURIComponent(only.tab)}`
      : `${terminalHref}?project=${encodeURIComponent(only.name)}`
    : terminalHref;
  const label =
    working.length === 1
      ? "1 agent working now — watch it"
      : `${working.length} agents working now — watch them`;
  return { count: working.length, href, label };
}
