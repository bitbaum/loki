/**
 * What was seen while something was said — the structured half of a voice
 * note, shared by the embed (which builds it) and the ingest (which validates
 * it) without either pulling in the other's dependencies. The limits are the
 * contract: the widget clamps to them, the route rejects past them
 * (scripts/test/widget-server-caps-mirror.ts holds the two together).
 */

export type ReportMomentTap = {
  /** The control's own label — never what was typed into it. */
  text: string;
  selector: string;
};

export type ReportMoment = {
  /** Milliseconds from the start of the recording. */
  at: number;
  page: string;
  /** The part of the page in view: its nearest heading. */
  label: string;
  marked?: boolean;
  /** Where the page was scrolled to, so a picture can be taken of the same view. */
  scrollY?: number;
  /** The text at the reading line, so "this" has a referent. */
  text?: string;
  /** The last thing tapped while this part was in view. */
  tap?: ReportMomentTap;
  /** The sentences said while this part was in view. */
  said?: string;
};

export const MOMENT_LIMITS = {
  count: 24,
  at: 86_400_000,
  page: 300,
  label: 80,
  scrollY: 1_000_000,
  text: 160,
  tapText: 80,
  selector: 500,
  said: 600,
} as const;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
const num = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null;

/**
 * unknown → the moments the contract allows, or []. Used by the widget on a
 * draft restored from storage and before every send, so nothing over a cap
 * ever reaches the route (which rejects the whole report naming no field).
 */
export function clampMoments(value: unknown): ReportMoment[] {
  if (!Array.isArray(value)) return [];
  const out: ReportMoment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const at = num(r.at, MOMENT_LIMITS.at);
    const page = str(r.page, MOMENT_LIMITS.page);
    const label = str(r.label, MOMENT_LIMITS.label);
    if (at === null || !page || !label) continue;
    const m: ReportMoment = { at, page, label };
    if (r.marked === true) m.marked = true;
    const scrollY = num(r.scrollY, MOMENT_LIMITS.scrollY);
    if (scrollY !== null) m.scrollY = scrollY;
    const text = str(r.text, MOMENT_LIMITS.text);
    if (text) m.text = text;
    const tap = r.tap as Record<string, unknown> | undefined;
    const tapText = str(tap?.text, MOMENT_LIMITS.tapText);
    const selector = str(tap?.selector, MOMENT_LIMITS.selector);
    if (tapText && selector) m.tap = { text: tapText, selector };
    const said = str(r.said, MOMENT_LIMITS.said);
    if (said) m.said = said;
    out.push(m);
    if (out.length >= MOMENT_LIMITS.count) break;
  }
  return out;
}

/** "0:41" */
export const momentClock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
