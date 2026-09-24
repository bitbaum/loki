/**
 * Surface modes for the embeddable Loki widget.
 *
 * Product direction: the live-site widget IS Loki-on-the-site — not only a
 * feedback form. Modes grow progressively:
 *   report  — point at anything, then Loki changes it or shows the way
 *             (file → Implement → Watch on captain Feedback; widget/intents.ts)
 *   chat    — conversation with Loki on the host page (seam; not full yet)
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
    hint: "Point at it — Loki changes it for you, or shows you the way.",
    shipped: true,
  },
  chat: {
    label: "Chat",
    hint: "Talk with Loki on this page. Coming next — use Report for now.",
    shipped: false,
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

export function parseWidgetSurfaceModes(raw: string | null | undefined): WidgetSurfaceMode[] {
  if (!raw || !raw.trim()) return ["report"];
  const wanted = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const out = WIDGET_SURFACE_MODES.filter((m) => wanted.has(m));
  return out.length ? out : ["report"];
}
