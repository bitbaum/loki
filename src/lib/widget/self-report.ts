/**
 * The widget reporting on ITSELF — Loki's own product, wherever it runs.
 *
 * Watch mode already reads the host page: a failed request, a frozen tap,
 * content jumping. Everything it saw about the widget itself it threw away on
 * purpose (a reviewer that blames the site for Loki's own work is worse than
 * one that says nothing — watch.ts observePerformance). Thrown away is not the
 * same as fixed: the widget's own crashes, its own calls to Loki failing, a
 * panel too wide for the phone it opened on — nobody heard about any of it
 * unless the operator happened to be the one holding the phone.
 *
 * So the widget keeps both halves apart and files each where it belongs:
 * the page's problems to the site's project (api/feedback), its own to
 * LOKI's project — the one FEEDBACK_WIDGET_TOKEN belongs to, where the
 * dogfood widget and a thumbs-down on a Loki answer already land.
 *
 * Pure (body in, row fields out); the route is the only I/O.
 */

/** What the widget can say about itself. `note` is a person writing it
 *  ("About: Loki itself"); the rest it noticed on its own. */
export const WIDGET_SELF_KINDS = ["note", "error", "request", "slow", "overflow"] as const;
export type WidgetSelfKind = (typeof WIDGET_SELF_KINDS)[number];

/** Where these rows sit in Loki's own inbox. */
export const WIDGET_SELF_PAGE = "/widget";

export const WIDGET_SELF_DETAIL_MAX = 600;
export const WIDGET_SELF_NOTE_MAX = 2000;

/**
 * Only the owner's browser files on its own. A visitor never agreed to their
 * browser telling a third party anything, so an unprompted report needs the
 * owner pass — the same person who switched Watch on. A note is a person
 * pressing Send, which is consent in itself.
 */
export function selfReportNeedsOwner(kind: WidgetSelfKind): boolean {
  return kind !== "note";
}

const LABEL: Record<Exclude<WidgetSelfKind, "note">, string> = {
  error: "The widget threw an error",
  request: "A call from the widget to Loki failed",
  slow: "A call from the widget to Loki was very slow",
  overflow: "The widget's panel did not fit the screen",
};

/** "https://example.com" from the host page's URL; null when it is not one. */
export function hostOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildSelfReport(input: {
  kind: WidgetSelfKind;
  /** What the widget saw, in its own words (auto kinds). */
  detail?: string | null;
  /** What the person wrote (note). */
  note?: string | null;
  /** The host page the widget was on. */
  url?: string | null;
  /** "390×844" — layout findings mean nothing without it. */
  viewport?: string | null;
}): { suggestion: string; noticeKey: string | null; pageTitle: string } {
  const origin = hostOrigin(input.url) ?? "an unknown site";
  const where = `on ${origin}${input.viewport ? ` at ${input.viewport}` : ""}`;
  const detail = (input.detail ?? "").trim().slice(0, WIDGET_SELF_DETAIL_MAX);
  if (input.kind === "note") {
    const note = (input.note ?? "").trim().slice(0, WIDGET_SELF_NOTE_MAX);
    return {
      suggestion: `About the Loki widget itself, ${where}:\n${note}`,
      noticeKey: null,
      pageTitle: `Loki widget — ${origin}`,
    };
  }
  return {
    suggestion: `${LABEL[input.kind]} ${where}.${detail ? `\n${detail}` : ""}`,
    // One row per kind per site: the same crash seen on a hundred visits is
    // one problem with a duplicate count, not a hundred rows.
    noticeKey: `widget-self|${input.kind}|${origin}`,
    pageTitle: `Loki widget — ${origin}`,
  };
}
