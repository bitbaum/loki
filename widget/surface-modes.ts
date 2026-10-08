/**
 * Surface modes for the embeddable Loki widget.
 *
 * Product direction: the live-site widget IS Loki-on-the-site — not only a
 * feedback form. Modes grow progressively:
 *   report  — today's form (file → Implement → Watch on captain Feedback)
 *   ask     — a second opinion on THIS site: "is this right, should it change,
 *             how would you make it better?", answered about the element, page
 *             or whole site the visitor is looking at (widget/advise.ts). ON BY
 *             DEFAULT next to Report: it is the same job — improving the site —
 *             done before a request is filed rather than after, and a
 *             recommended change is one tap from becoming a report.
 *   chat    — a plain chat the Cat and Loki both live in; whichever the
 *             question belongs to answers, from the fleet map, and sends the
 *             visitor to the right project. OPT-IN: the
 *             same bundle runs on pilot sites that never asked for a studio
 *             front desk, so an embed gets chat only by listing it.
 *   watch   — not a panel tab. Watch mode ships as an OWNER feature
 *             (widget/watch.ts): it switches on by itself when the owner
 *             arrives through Loki's "Open your site" link, shows a "Loki is
 *             watching" pill the whole time it records, and files a fix when
 *             something on the page breaks. Its Review button hands the
 *             session to Ask, which judges it — errors, design, engineering,
 *             process, product — with each change one tap from being built.
 *             Visitors are never watched.
 *
 * Keep this file free of DOM so the captain app and the IIFE bundle can share
 * labels/ids without dragging Shadow DOM into Node tests.
 */
export const WIDGET_SURFACE_MODES = ["report", "ask", "chat", "watch"] as const;
export type WidgetSurfaceMode = (typeof WIDGET_SURFACE_MODES)[number];

export const WIDGET_SURFACE_MODE_META: Record<
  WidgetSurfaceMode,
  { label: string; hint: string; shipped: boolean }
> = {
  report: {
    label: "Request a change",
    hint: "Say what should change. It goes straight to whoever builds this site.",
    shipped: true,
  },
  ask: {
    label: "Ask Loki",
    hint: "Not sure it should change? Ask Loki for an honest second opinion first.",
    shipped: true,
  },
  chat: {
    label: "Chat",
    hint: "Ask about any project — the Cat and Loki are both in here.",
    shipped: true,
  },
  watch: {
    label: "Watch",
    hint: "Loki watches you use your own site, fixes what breaks, and on Review says what could be better.",
    shipped: false,
  },
};

export function defaultWidgetSurfaceMode(): WidgetSurfaceMode {
  return "report";
}

/** What an embed with no `data-fc-modes` gets: request a change, or ask first. */
export const DEFAULT_WIDGET_SURFACE_MODES: WidgetSurfaceMode[] = ["report", "ask"];

/**
 * The embed's `data-fc-modes`, in the ORDER the site wrote them — the first
 * listed mode is the one the panel opens in, so "chat,report" is a front desk
 * that can also take a report, and "report,chat" the reverse. Unknown names
 * and repeats are dropped; an absent or wholly invalid attribute gets the
 * default pair. `data-fc-modes="report"` is how a site opts out of Ask.
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

/** The mode the panel opens in: the first one the embed listed that works. */
export function initialWidgetSurfaceMode(modes: WidgetSurfaceMode[]): WidgetSurfaceMode {
  return modes.find((m) => WIDGET_SURFACE_MODE_META[m].shipped) ?? defaultWidgetSurfaceMode();
}
