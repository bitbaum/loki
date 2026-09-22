import { ChevronRight } from "lucide-react";

/**
 * Wraps a horizontal-scroll row (chip strip, tab strip, filter row) and adds
 * a mobile-only right-edge ChevronRight + fade mask so the user knows there's
 * more content past the visible viewport. Hidden on sm+ where the row is
 * expected to wrap naturally.
 *
 * Extracted from four duplicate call sites (Today SummaryBar, Settings tab
 * strip, Projects status chips + banner, Prompts CategoryBar) where the same
 * `relative wrapper + absolute pointer-events-none chevron + drop-shadow halo`
 * pattern had grown copy-pasted with subtle threshold variations.
 *
 * The chevron only shows when `childCount >= threshold` so single-chip or
 * single-tab rows don't get a misleading "scroll for more" cue.
 *
 * Callers own the scroll container and its overflow / fade classes — this
 * component is layout-only and doesn't mandate which scrollbar-hide or
 * fade-mask classes the caller uses.
 */
export function ScrollAffordance({
  children,
  childCount,
  threshold = 4,
}: {
  /** The scroll container — caller controls overflow + scrollbar-hide + fade. */
  children: React.ReactNode;
  /** Count of items in the row (chips/tabs/etc.); affordance hides when low. */
  childCount: number;
  /** Min children before showing the chevron. Default 4 ≈ ~414px overflow. */
  threshold?: number;
}) {
  return (
    <div className="relative">
      {children}
      {childCount >= threshold && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pr-1 text-text-tertiary sm:hidden"
        >
          <ChevronRight className="ui-scroll-affordance-glyph h-4 w-4" />
        </span>
      )}
    </div>
  );
}
