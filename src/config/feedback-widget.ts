/**
 * SSOT: where Loki shows its OWN feedback widget.
 *
 * This used to be an allowlist of eleven public marketing routes, justified in
 * a comment that gave two reasons. Both were checked, and neither holds:
 *
 *   "the widget FAB would collide with the app shell's mobile nav"
 *      — true when written. The widget now measures every candidate slot
 *        and never sits on a host control (the desktop Loki FAB, the mobile
 *        nav, any bottom sheet) at any width. See widget/README.md.
 *
 *   "in-app feedback already has Loki"
 *      — not true. `insertSiteFeedback` has exactly one caller, the widget's
 *        ingest route. Loki cannot file feedback; the word does not appear in
 *        loki-core.ts. Telling the assistant "this button is broken" produces
 *        no site_feedback row, nothing in the triage inbox, and nothing
 *        dispatchable. A signed-in user's only route was to tell the operator
 *        out of band.
 *
 * So the rule is inverted: the widget renders everywhere EXCEPT a short list of
 * surfaces where a floating button actively harms the task. An allowlist meant
 * every new page shipped without a way to report a bug on it, and nobody
 * noticed because the omission is invisible — the whole reason this product
 * exists is that unreported problems stay unfixed.
 */

/**
 * Surfaces that deliberately have no widget, each with the reason.
 * Matched exactly or by `/prefix/`.
 */
export const FEEDBACK_WIDGET_EXCLUDED_PREFIXES = [
  // A full-height PTY. A floating button over live terminal output covers the
  // thing the operator is reading, and the terminal has its own composer.
  "/terminal",
  // Same shape as /terminal, and measured rather than assumed: at 390px the
  // launcher's centre sits ON TOP of the composer's textarea (`.ck-input`) — the
  // box you type into on the page whose whole purpose is typing into it.
  //
  // Not a failure of the widget's avoidance. `INTERACTIVE` already matches
  // `textarea` and the 260px shift cap was never reached: autoAvoid moved the
  // launcher 164px up and correctly found a clear spot, then the composer
  // reflowed under it once the conversation list loaded. The widget re-checks
  // at two fixed moments after paint, not on layout change, so a late reflow
  // wins. Fixing that properly means a ResizeObserver in a bundle that runs on
  // other people's sites; excluding the one page in this app that puts a
  // full-width composer at the bottom is the honest small fix, and Loki is
  // where you would talk to the assistant about a problem anyway.
  "/loki",
  // Not in the product yet. Feedback here would be about the door, not the
  // room, and an anonymous FAB on a credential form is the wrong invitation.
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/setup",
  "/invite",
  // The widget itself. Rendering the launcher on the page that documents the
  // launcher makes "is this yours or the demo's?" an unanswerable question.
  "/docs/feedback-widget",
] as const;

export function isFeedbackWidgetRoute(pathname: string): boolean {
  const path = pathname || "/";
  return !FEEDBACK_WIDGET_EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
