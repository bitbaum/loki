/**
 * Surface modes for the embeddable Loki widget.
 *
 * Product direction: the live-site widget IS Loki-on-the-site — not only a
 * feedback form. Modes grow progressively:
 *   report  — today's form (file → Implement → Watch on captain Feedback)
 *   chat    — conversation on the host page with Loki (development agent) or
 *             Cat (economic agent); the default. See ./agents.ts
 *   watch   — observe how the visitor uses the page and comment (seam)
 *
 * Keep this file free of DOM so the captain app and the IIFE bundle can share
 * labels/ids without dragging Shadow DOM into Node tests.
 */
export const WIDGET_SURFACE_MODES = ["chat", "report", "watch"] as const;
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
    hint: "Talk with Loki about this site, or with Cat about funding and payments.",
    shipped: true,
  },
  watch: {
    label: "Watch",
    hint: "Loki observes how you use the page and comments. Coming next.",
    shipped: false,
  },
};

export function defaultWidgetSurfaceMode(): WidgetSurfaceMode {
  return "chat";
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
