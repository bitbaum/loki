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
  // (/terminal and /loki are NOT here. Both used to be — a floating button over
  // live PTY output, or on top of the full-width composer at 390px — and both
  // exclusions left the most-used pages with no visible way to report
  // anything (bitbaum/loki#1037). They now carry data-fc-place="tab": the
  // launcher is the slim edge tab there, off the corners those pages use.
  // The rule a person can predict: the launcher is on every page past sign-in,
  // as a corner button or an edge tab, unless they switched it off themselves
  // (account menu → Hide feedback button).)
  //
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
