/**
 * Watch mode's memory, kept pure so it is tested without a browser
 * (scripts/test/widget-watch.ts).
 *
 * While the site's OWNER has the page open through Loki's "Open your site"
 * link, the widget keeps a short trail of what happened — taps, pages, the
 * site's own requests, errors — and when something fails it files a report
 * with that trail attached, which starts a fix (the owner pass makes it a
 * build, not a triage item). This file decides what goes in the trail, what
 * counts as a failure, and what the report says.
 *
 * Privacy by construction: a tap is described by the control's own label
 * (button text, aria-label, an input's placeholder) and NEVER by what was
 * typed into it; a request by method, path and status, never its body or
 * query string.
 */
import type { ReportDiagnostics } from "./report-payload";

export type TrailKind = "tap" | "page" | "request" | "error";
export type TrailEntry = { at: number; kind: TrailKind; text: string };
export type Failure = { kind: "error" | "request"; text: string };

/** The last this-many things — enough to reproduce, small enough to read. */
export const TRAIL_MAX = 20;
/** Reports filed automatically per page load, at most. */
export const WATCH_REPORTS_PER_PAGE = 3;
const TEXT_MAX = 60;

export function pushTrail(trail: TrailEntry[], entry: TrailEntry): TrailEntry[] {
  const text = entry.text.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!text) return trail;
  const last = trail[trail.length - 1];
  // A double tap or a re-render's repeat request is one fact, not two.
  if (last && last.kind === entry.kind && last.text === text) return trail;
  return [...trail, { ...entry, text }].slice(-TRAIL_MAX);
}

/** What a tapped control was, in words — its label, never its value. */
export function describeControl(c: {
  tag: string;
  role?: string | null;
  type?: string | null;
  label?: string | null;
  text?: string | null;
  placeholder?: string | null;
}): string {
  const tag = c.tag.toLowerCase();
  const kind =
    c.role === "button" || tag === "button"
      ? "button"
      : tag === "a"
        ? "link"
        : tag === "input" || tag === "textarea" || tag === "select"
          ? `${c.type && tag === "input" ? `${c.type} ` : ""}field`
          : tag;
  const name = (c.label || c.text || c.placeholder || "").replace(/\s+/g, " ").trim();
  return name ? `${kind} “${name.slice(0, TEXT_MAX)}”` : kind;
}

/** A request worth a report: the server broke (5xx) or never answered. */
export function isFailedRequest(status: number | null): boolean {
  return status === null || status >= 500;
}

/** "GET /api/projects → 500" — path only: query strings carry tokens. */
export function describeRequest(method: string, url: string, status: number | null): string {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    /* keep what we were given */
  }
  return `${method.toUpperCase()} ${path} → ${status === null ? "no response" : status}`;
}

/** Errors the browser raises about itself, not about the site. */
export function isNoiseError(message: string): boolean {
  return /ResizeObserver loop|^Script error\.?$|AbortError|The user aborted|Load failed$/i.test(
    message.trim(),
  );
}

/** Same failure, same signature — ids and numbers do not make it new. */
export function failureSignature(f: Failure): string {
  return `${f.kind}:${f.text.replace(/[0-9a-f]{8,}|\d+/gi, "#").slice(0, 120)}`;
}

/** The report a failure files: one sentence, then the trail as diagnostics. */
export function watchReport(
  f: Failure,
  trail: TrailEntry[],
  now: number,
): { message: string; diagnostics: ReportDiagnostics } {
  const message =
    f.kind === "request"
      ? `While I was using this page a request failed: ${f.text}. Fix it so this works.`
      : `While I was using this page it hit an error: ${f.text}. Fix it so this works.`;
  const diagnostics: ReportDiagnostics = { "filed by": "Loki watch mode", failure: f.text };
  const recent = trail.slice(-12);
  recent.forEach((e, i) => {
    const ago = Math.max(0, Math.round((now - e.at) / 1000));
    diagnostics[`step ${i + 1}`] = `${e.kind} ${e.text} (${ago}s ago)`;
  });
  return { message, diagnostics };
}
