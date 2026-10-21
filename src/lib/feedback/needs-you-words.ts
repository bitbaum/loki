/**
 * The words of the "feedback needs you" alert (notify-needs-you.ts) — pure,
 * so they are tested without a database.
 *
 * It read "84 feedback items need you (stalled + check live)" over "Failed —
 * It never reached an agent — Retry, or check the builder is online.", which
 * a person had to decode (owner, 2026-10-21). Now: one plain sentence for the
 * title, one for what to do.
 */

/** "3 feedback fixes stopped, and 2 are live for you to check". */
export function needsYouTitle(stuck: number, live: number): string {
  const fixes = (n: number) => `${n} feedback fix${n === 1 ? "" : "es"}`;
  if (stuck && live) {
    return `${fixes(stuck)} stopped, and ${live} ${live === 1 ? "is" : "are"} live for you to check`;
  }
  if (stuck) return `${fixes(stuck)} stopped and ${stuck === 1 ? "needs" : "need"} you`;
  return `${fixes(live)} ${live === 1 ? "is" : "are"} live for you to check`;
}

/** What to do about it, in one sentence — not the first item's status words. */
export function needsYouDescription(stuck: number, live: number): string {
  if (stuck && live) {
    return "Open Feedback to start the stopped ones again and confirm the ones that are live.";
  }
  if (stuck) return "Open Feedback to start them again.";
  return "Open Feedback, look at each one on the site and confirm it.";
}
