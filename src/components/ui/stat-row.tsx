/**
 * Three-up stats row. Wraps children in the canonical grid that the audit
 * settled on so all four call sites — Goals, Memory, Money, Habits — share
 * one source of truth for the layout.
 *
 * Callers own the card shape inside (StatCard for label+value+sub, or
 * Card+CardHeader for icon-led variants). The primitive only owns the
 * column wrapper.
 *
 * `grid-cols-3` unconditionally (all widths) measured at ~120px per card on
 * a 390px phone — three bordered, padded StatCards each holding a 2xl bold
 * number, for stats that inform no decision on any of the pages.
 *
 * Below `sm` the row is therefore a horizontally scrolling strip of pills
 * (`.ui-stat-row`), reverting to the three-column grid from `sm` up. This
 * comment used to describe a two-column grid with `:last-child:nth-child(odd)`
 * spanning the odd card — no such rule has ever existed in globals.css. The
 * layout was replaced by the scroll strip and the description was left behind,
 * which is worse than no comment: it sends the next reader looking for a rule
 * to adjust that is not there.
 *
 * `ui-scroll-fade-right` is not decoration. The strip hides its scrollbar
 * (`[scrollbar-width:none]`), so without the fade the last card is simply cut
 * off with nothing to say it continues. Measured on /feedback at 390px: the
 * third stat sat entirely off-screen and the second ended mid-word — which
 * reads as a broken layout, not as an invitation to swipe. The same pairing
 * is already used by PeopleGrid, ThoughtsLibrary and GroupBar.
 *
 * Extracted after the same pattern was duplicated 4× across pages, in
 * the same iteration the ScrollAffordance refactor (0429728) paid off
 * one commit later — both consolidate proven UI primitives so the 5th
 * occurrence is a one-line wrap.
 */
export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="ui-stat-row ui-scroll-fade-right">{children}</div>;
}
