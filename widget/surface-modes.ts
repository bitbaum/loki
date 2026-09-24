/**
 * Surface modes for the embeddable Loki widget.
 *
 * Product direction: the live-site widget IS Loki-on-the-site — not only a
 * feedback form. Modes grow progressively:
 *   report  — today's form (file → Implement → Watch on captain Feedback)
 *   chat    — a plain chat the Cat and Loki both live in; whichever the
 *             question belongs to answers, from the fleet map, and sends the
 *             visitor to the right project. OPT-IN: the
 *             same bundle runs on pilot sites that never asked for a studio
 *             front desk, so an embed gets chat only by listing it.
 *   watch   — observe how the visitor uses the page and comment (seam)
 *
 * Keep this file free of DOM so the captain app and the IIFE bundle can share
 * labels/ids without dragging Shadow DOM into Node tests.
 */
export const WIDGET_SURFACE_MODES = ["report", "chat", "watch"] as const;
export type WidgetSurfaceMode = (typeof WIDGET_SURFACE_MODES)[number];

export const WIDGET_SURFACE_MODE_META: Record<
  WidgetSurfaceMode,
  { label: string; hint: string; shipped: boolean }
> = {
  report: {
    label: "Report",
    hint: "File what is wrong — Loki Implement picks it up.",
    shipped: true,
  },
  chat: {
    label: "Chat",
    hint: "Ask about any project — the Cat and Loki are both in here.",
    shipped: true,
  },
  watch: {
    label: "Watch",
    hint: "Loki observes how you use the page and comments. Coming next.",
    shipped: false,
  },
};

export function defaultWidgetSurfaceMode(): WidgetSurfaceMode {
  return "report";
}

/**
 * The embed's `data-fc-modes`, in the ORDER the site wrote them — the first
 * listed mode is the one the panel opens in, so "chat,report" is a front desk
 * that can also take a report, and "report,chat" the reverse. Unknown names
 * and repeats are dropped; nothing valid falls back to Report alone.
 */
export function parseWidgetSurfaceModes(raw: string | null | undefined): WidgetSurfaceMode[] {
  if (!raw || !raw.trim()) return ["report"];
  const out: WidgetSurfaceMode[] = [];
  for (const name of raw.split(",").map((s) => s.trim().toLowerCase())) {
    const mode = WIDGET_SURFACE_MODES.find((m) => m === name);
    if (mode && !out.includes(mode)) out.push(mode);
  }
  return out.length ? out : ["report"];
}

/** The mode the panel opens in: the first one the embed listed that works. */
export function initialWidgetSurfaceMode(modes: WidgetSurfaceMode[]): WidgetSurfaceMode {
  return modes.find((m) => WIDGET_SURFACE_MODE_META[m].shipped) ?? defaultWidgetSurfaceMode();
}
