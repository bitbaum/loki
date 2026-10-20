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
 *
 * Review (the pill's button) reads the same trail: it is what lets Loki say
 * what the owner was trying to do and judge the site against it — errors,
 * design, engineering, process and product — instead of only reacting when
 * something throws.
 */
import { plainCheck } from "./plain-checks";
import type { ReportDiagnostics } from "./report-payload";

/**
 * `notice` is what a demanding reviewer would remark on that is NOT a failure:
 * a 404, a slow request, a console error, a page that took four seconds, the
 * main thread freezing. It never files a fix by itself; Review judges it
 * alongside the taps around it.
 */
/**
 * `look` is Loki's own look at a page once it settled (page-checks.ts) — kept
 * even when it found nothing, because "looked, all fine" is exactly what the
 * owner could not see before: watch only ever spoke when something was wrong,
 * so between remarks it was impossible to tell what it was doing.
 */
/**
 * `talk` is the owner talking to Loki in the panel. Taps inside Loki's own
 * panel never enter the trail (they are not the site), so before this kind a
 * Review saw a conversation with Loki as minutes of silence and read it as
 * the site not responding (operator's phone, 2026-10-15: "the page never
 * responded for 194 s" — those 194 s were spent asking Loki).
 */
export type TrailKind =
  "tap" | "page" | "request" | "error" | "notice" | "look" | "result" | "talk";
export type TrailEntry = { at: number; kind: TrailKind; text: string };
export type Failure = { kind: "error" | "request" | "dead-tap"; text: string };

/**
 * The last this-many things. A failure report quotes only the newest twelve;
 * Review reads the lot, which is what lets it follow what the owner was doing
 * across several pages rather than only the moment something broke.
 */
export const TRAIL_MAX = 60;
/** A trail kept across page loads is this session's, not last week's. */
export const TRAIL_MAX_AGE_MS = 30 * 60_000;
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

/** "GET /api/projects → 500" — path only: query strings carry tokens. A
 *  duration, when given, is in tenths of a second: "→ 200 in 4.2s". */
export function describeRequest(
  method: string,
  url: string,
  status: number | null,
  ms?: number,
): string {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    /* keep what we were given */
  }
  const took = ms === undefined ? "" : ` in ${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  return `${method.toUpperCase()} ${path} → ${status === null ? "no response" : status}${took}`;
}

/** Slower than this and a person notices the wait. */
export const SLOW_REQUEST_MS = 3_000;

/**
 * A request that did not fail but is still worth a remark: refused or pointed
 * at something that is not there (4xx), or slow. Failures (5xx, no answer)
 * belong to isFailedRequest, never to both.
 */
export function isNoticeableRequest(status: number | null, ms: number): boolean {
  if (status === null || status >= 500) return false;
  return status >= 400 || ms >= SLOW_REQUEST_MS;
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
      : f.kind === "dead-tap"
        ? `I pressed ${f.text} three times and nothing happened. Make it do what it says.`
        : `While I was using this page it hit an error: ${f.text}. Fix it so this works.`;
  const diagnostics: ReportDiagnostics = {
    "filed by": "Loki watch mode",
    failure: f.text,
    ...trailDiagnostics(trail, now),
  };
  return { message, diagnostics };
}

/** The trail as numbered report lines, newest twelve, with how long ago. */
export function trailDiagnostics(trail: TrailEntry[], now: number): ReportDiagnostics {
  const out: ReportDiagnostics = {};
  trail.slice(-12).forEach((e, i) => {
    const ago = Math.max(0, Math.round((now - e.at) / 1000));
    out[`step ${i + 1}`] = `${e.kind} ${e.text} (${ago}s ago)`;
  });
  return out;
}

/**
 * A button that does nothing. Nothing throws, nothing fails — the person just
 * taps it again, and again. Three taps on the same button or link within the
 * window, with no page change and no request in between, is that.
 */
export const DEAD_TAP_COUNT = 3;
export const DEAD_TAP_WINDOW_MS = 5_000;

export type TapStreak = { text: string; count: number; since: number } | null;

/** Fold a tap into the streak; `dead` is true on the tap that completes it. */
export function nextTapStreak(
  streak: TapStreak,
  text: string,
  now: number,
): { streak: TapStreak; dead: boolean } {
  // Fields get tapped to focus them; only something meant to DO a thing counts.
  if (!/^(button|link)\b/.test(text)) return { streak: null, dead: false };
  const same = streak && streak.text === text && now - streak.since <= DEAD_TAP_WINDOW_MS;
  const next = same ? { ...streak, count: streak.count + 1 } : { text, count: 1, since: now };
  return next.count >= DEAD_TAP_COUNT
    ? { streak: null, dead: true }
    : { streak: next, dead: false };
}

/** Drop what is older than this session and anything malformed — a trail
 *  restored from storage after a page load is untrusted input. */
export function freshTrail(trail: unknown, now: number): TrailEntry[] {
  if (!Array.isArray(trail)) return [];
  const kinds: TrailKind[] = [
    "tap",
    "page",
    "request",
    "error",
    "notice",
    "look",
    "result",
    "talk",
  ];
  return trail
    .filter(
      (e): e is TrailEntry =>
        !!e &&
        typeof e.at === "number" &&
        typeof e.text === "string" &&
        kinds.includes(e.kind) &&
        now - e.at <= TRAIL_MAX_AGE_MS &&
        e.at <= now,
    )
    .map((e) => ({ at: e.at, kind: e.kind, text: e.text.slice(0, 160) }))
    .slice(-TRAIL_MAX);
}

/** How many things Loki has remarked on — what the pill counts. */
export function noticeCount(trail: TrailEntry[]): number {
  return trail.filter((e) => e.kind === "notice" || e.kind === "error").length;
}

/** Mirrors ADVISE_MAX_SESSION in src/lib/widget-advise/advisor.ts. */
export const REVIEW_SESSION_MAX = 6_000;
/** A gap this long between two steps reads as the person stopping to think. */
export const HESITATION_MS = 20_000;

/**
 * The session as Review sends it: what the owner did, in order, with the
 * pauses between steps written out (forty seconds before a button is a finding
 * in itself), then what the page checks found. When it is too long the OLDEST
 * steps go — the end of a session is where the question usually is.
 */
export function sessionForReview(trail: TrailEntry[], checks: string[], now: number): string {
  const steps: string[] = [];
  let prev: number | null = null;
  for (const e of trail) {
    if (prev !== null && e.at - prev >= HESITATION_MS) {
      steps.push(`(paused ${Math.round((e.at - prev) / 1000)}s)`);
    }
    steps.push(`${e.kind} ${e.text}`);
    prev = e.at;
  }
  if (prev !== null && now - prev >= HESITATION_MS) {
    steps.push(`(nothing for ${Math.round((now - prev) / 1000)}s, then asked for this review)`);
  }
  const head = "What they did, oldest first:\n";
  const tail = checks.length
    ? `\n\nChecks on the page they are on now:\n${checks.map((c) => `- ${c}`).join("\n")}`
    : "";
  let body = steps.length ? steps.join("\n") : "(nothing yet — they have only just arrived)";
  const room = REVIEW_SESSION_MAX - head.length - tail.length;
  if (body.length > room) body = `…\n${body.slice(body.length - room + 2)}`;
  return `${head}${body}${tail}`.slice(0, REVIEW_SESSION_MAX);
}

/** What watch remarked on, as recorded — `after` is the tap that led there. */
export type NoticeKind =
  "4xx" | "slow" | "console" | "load" | "longtask" | "cls" | "checks" | "noeffect";
export type Notice = { kind: NoticeKind; text: string; after?: string | null };

const STATUS_WORDS: Record<number, string> = {
  400: "was rejected as malformed",
  401: "was refused — not signed in",
  403: "was refused — not allowed",
  404: "found nothing there (404)",
  405: "was refused — wrong kind of request",
  408: "timed out",
  409: "hit a conflict",
  410: "is gone",
  413: "was too large",
  422: "was rejected as invalid",
  429: "was turned away — too many requests",
};

/**
 * A remark in words the owner reads in the conversation — what happened, after
 * what — and the change request "Fix this" would send. Pure: built from the
 * recorded text alone, by rules, so speaking up costs no model call (no
 * background AI on the shared free tier). "Why?" is where a model comes in.
 */
export function explainNotice(n: Notice): { say: string; fix: string } {
  const after = n.after ? `After you pressed ${n.after}, ` : "";
  const afterFix = n.after ? ` after pressing ${n.after}` : "";
  const req = /^([A-Z]+) (\S+) \u2192 (\d{3}|no response)(?: in ([\d.]+)s)?/.exec(n.text);
  if ((n.kind === "4xx" || n.kind === "slow") && req) {
    const [, , path, status, secs] = req;
    if (n.kind === "slow") {
      return {
        say: `${after}the page waited ${secs}s for ${path} — long enough to feel broken.`,
        fix: `Make ${path} answer faster${afterFix} (it took ${secs}s).`,
      };
    }
    const words = STATUS_WORDS[Number(status)] ?? `was rejected (${status})`;
    return {
      say: `${after}the page asked for ${path} and it ${words}.`,
      fix: `Fix the request to ${path}${afterFix}: it answers ${status}.`,
    };
  }
  switch (n.kind) {
    case "console": {
      const msg = n.text.replace(/^console error:\s*/, "");
      return {
        say: `${after}the page reported an error of its own: “${msg}”.`,
        fix: `Fix the error this page logs${afterFix}: “${msg}”.`,
      };
    }
    case "load":
      return {
        say: `This page was slow to arrive — ${n.text.replace(/^this page /, "it ")}. Some visitors leave before that.`,
        fix: `Make this page load faster — ${n.text.replace(/^this page /, "it ")}.`,
      };
    case "longtask":
      return {
        say: `${n.text.charAt(0).toUpperCase()}${n.text.slice(1)}.`,
        fix: `Stop the page freezing ${n.text.replace(/ the page froze for .*$/, "").replace(/^after /, "after ")}.`,
      };
    case "noeffect":
      return {
        say: `You pressed ${n.text} and nothing visibly happened — nothing on the page changed and nothing was sent.`,
        fix: `Make ${n.text} do something visible when pressed (or say why it can't).`,
      };
    case "cls":
      return {
        say: "Content jumped around on this page while you were looking at it — easy to press the wrong thing.",
        fix: "Stop the content on this page jumping around as it loads (reserve space for what arrives late).",
      };
    default:
      return { say: n.text, fix: n.text };
  }
}

/**
 * The page checks as one remark: a short list, and one request that fixes them
 * all. Null when the page is clean — silence is the right answer then.
 */
export function explainChecks(
  checks: string[],
  /** Which page, by name ("Voice"): the card outlives the page it is about,
   *  and three "Looking at this page" cards from three pages read as one
   *  remark said three times. */
  page?: string,
): { say: string; fix: string; short: string } | null {
  if (!checks.length) return null;
  const list = checks.map((c) => `• ${c}`).join("\n");
  // Said in plain words (plain-checks.ts); the fix request keeps the exact
  // finding, which is what a builder needs.
  const plain = checks.map((c) => `• ${plainCheck(c)}`).join("\n");
  const where = page ? `the ${page} page` : "this page";
  return {
    say: `Looking at ${where}, ${checks.length === 1 ? "one thing stands out" : `${checks.length} things stand out`}:\n${plain}`,
    fix: `Fix these on this page:\n${list}`,
    short: `${checks.length === 1 ? "one thing" : `${checks.length} things`} on this page could be better`,
  };
}

/**
 * Findings about the document, not about anything on it — the same on every
 * page a site renders from one layout. The owner walked four Petvity pages on
 * 2026-10-18 and was told "the page does not declare its language" on each:
 * one fix, said as four. Said once per visit; the next pages leave it out.
 */
const SITE_WIDE_CHECKS: readonly RegExp[] = [/<html lang>/i];

/** The site-wide findings among `checks` that have not been said this visit,
 *  and the keys to remember them by once they are. */
export function onceSiteWide(
  checks: readonly string[],
  said: ReadonlySet<string>,
  /** The page being looked at. The page a site-wide finding was FIRST said
   *  on keeps it: that page's card is re-read on a revisit, and dropping the
   *  line there made a finding look fixed that was not. */
  path?: string,
): { checks: string[]; keys: string[] } {
  const keys: string[] = [];
  const kept = checks.filter((check) => {
    const rule = SITE_WIDE_CHECKS.find((re) => re.test(check));
    if (!rule) return true;
    const key = `site|${rule.source}`;
    if (said.has(key)) return path !== undefined && said.has(`${key}@${path}`);
    keys.push(key);
    if (path !== undefined) keys.push(`${key}@${path}`);
    return true;
  });
  return { checks: kept, keys };
}

/**
 * What a finding is ABOUT, without its count or its example: "2 form
 * field(s) have no label — only a placeholder like “Name”" and "1 form
 * field(s) have no label" are one finding. "No main heading" and "3 main
 * headings" are one too — the page's title — and are never two cards.
 */
export function findingKind(check: string): string {
  if (/main heading/.test(check)) return "The page's main heading (h1)";
  return check
    .replace(/\s*\(e\.g\.[^)]*\)/g, "")
    .replace(/\s+\u2014 only a placeholder like .*$/, "")
    .replace(/\d+(\.\d+)?/g, "#")
    .trim();
}

/**
 * Two readings of one page, a moment apart: what the LATER one found, where
 * the earlier one found the same. A page caught mid-swap — a setup screen
 * leaving, the next one arriving — reads "2 main headings", then "no main
 * heading", then settles; each reading used to be said as it was taken
 * (/voice, operator's phone, 2026-10-20). What the two disagree on waits
 * until the page holds still. The heading's COUNT must agree too: "2" then
 * "none" is the page moving, not a finding.
 */
export function stableChecks(earlier: readonly string[], later: readonly string[]): string[] {
  const id = (c: string) => (/main heading/.test(c) ? c : findingKind(c));
  const seen = new Set(earlier.map(id));
  return later.filter((c) => seen.has(id(c)));
}

/**
 * The page checks' signature: the KINDS of finding on this path, not their
 * counts or their first example. "30 pieces of text under 12px (e.g. “Partners”)"
 * and "6 pieces … (e.g. “AI-native …”)" are one finding said twice; the owner
 * got two cards for it (2026-10-09). Digits and the example are dropped.
 */
export function checksSignature(path: string, checks: readonly string[]): string {
  return `${checksSlot(path)}|${checks.map(findingKind).join("|")}`;
}

/**
 * The one card a page's checks own. A new reading of the same page replaces
 * it — never a second card beside it (2026-10-20: "no main title" three
 * times in one panel, "1 form field" and "2 form fields" both shown).
 */
export function checksSlot(path: string): string {
  return `${path}|checks`;
}

/** Same remark, same signature — so a reload does not say it again. */
export function noticeSignature(path: string, n: Notice): string {
  return `${path}|${n.kind}|${n.text.replace(/\d+(\.\d+)?/g, "#").slice(0, 120)}`;
}
