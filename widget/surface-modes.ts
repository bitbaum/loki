/**
 * `data-fc-modes` — what an embed lets the widget's one conversation do.
 *
 * There are no tabs any more (widget/conversation.ts): one thread, in which
 * you talk to Loki and anything worth building is sent to the builder. The
 * attribute now only decides WHO answers there (widget/thread.ts assistantFor):
 *   report — no AI: messages go straight to the builder, after a confirmation.
 *   ask    — the site advisor answers about this page or site (the default).
 *   chat   — a studio front desk: the Cat and Loki answer from the fleet map.
 *   watch  — accepted and ignored: Watch is the OWNER's, switched on from the
 *            panel header (widget/watch.ts, src/app/api/widget/owner), never
 *            by an embed, and visitors are never watched.
 * The owner always gets the advisor, whatever the embed lists.
 *
 * Keep this file free of DOM so Node tests can import it.
 */
export const WIDGET_SURFACE_MODES = ["report", "ask", "chat", "watch"] as const;
export type WidgetSurfaceMode = (typeof WIDGET_SURFACE_MODES)[number];

/** What an embed with no `data-fc-modes` gets: request a change, or ask first. */
export const DEFAULT_WIDGET_SURFACE_MODES: WidgetSurfaceMode[] = ["report", "ask"];

/**
 * The embed's `data-fc-modes`, in the order written. Unknown names and repeats
 * are dropped; an absent or wholly invalid attribute gets the default pair.
 * `data-fc-modes="report"` is how a site opts out of AI answers.
 */
export function parseWidgetSurfaceModes(raw: string | null | undefined): WidgetSurfaceMode[] {
  if (!raw || !raw.trim()) return [...DEFAULT_WIDGET_SURFACE_MODES];
  const out: WidgetSurfaceMode[] = [];
  for (const name of raw.split(",").map((s) => s.trim().toLowerCase())) {
    const mode = WIDGET_SURFACE_MODES.find((m) => m === name);
    if (mode && !out.includes(mode)) out.push(mode);
  }
  return out.length ? out : [...DEFAULT_WIDGET_SURFACE_MODES];
}
