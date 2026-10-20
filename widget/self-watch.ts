/**
 * Watch, turned on the widget itself.
 *
 * Watch mode reads the host page and is careful never to blame the site for
 * Loki's own work: its own requests, its own errors, its own panel moving are
 * all left out of what it says about the page (watch.ts). Left out used to
 * mean dropped. Now they come here, and what is wrong with the WIDGET is filed
 * to Loki's own project (/api/widget/self-report) — the page's problems go to
 * the site, Loki's to Loki.
 *
 * Same rules as the rest of Watch: only while the owner is watching (stopped
 * means nothing is recorded), precision over coverage (each signal is one the
 * widget can pin on itself without guessing), once per kind per tab, and said
 * in the conversation in one plain line so the owner knows it went somewhere.
 */
import { sendSelfReport, type SelfKind } from "./self-report";

/** A call to Loki slower than this is worth Loki hearing about. Advice is a
 *  model call and takes seconds; this is well past "thinking". */
export const SELF_SLOW_MS = 20_000;
/** At most this many self-reports per page view, whatever happens. */
const SELF_PER_PAGE = 3;

type Finding = { kind: Exclude<SelfKind, "note">; detail: string };

/**
 * What a call from the widget to Loki says about the widget. A 4xx is Loki
 * answering on purpose (paused, rate-limited, a pass that expired) and is
 * not a defect; no answer or a 5xx is.
 */
export function classifyOwnRequest(
  method: string,
  url: string,
  status: number | null,
  ms: number,
): Finding | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* already a path */
  }
  if (status === null || status >= 500)
    return {
      kind: "request",
      detail: `${method} ${path} ${status === null ? "never answered" : `answered ${status}`} after ${(ms / 1000).toFixed(1)}s`,
    };
  if (ms >= SELF_SLOW_MS)
    return { kind: "slow", detail: `${method} ${path} took ${(ms / 1000).toFixed(1)}s` };
  return null;
}

/** Wider than its box, or hanging off the screen: the panel did not fit. */
export function panelOverflow(
  box: { left: number; right: number; scrollWidth: number; clientWidth: number },
  viewportWidth: number,
): string | null {
  if (box.scrollWidth > box.clientWidth + 1)
    return `the panel scrolls sideways (${box.scrollWidth}px of content in ${box.clientWidth}px)`;
  if (box.left < -1 || box.right > viewportWidth + 1)
    return `the panel hangs off the screen (${Math.round(box.left)}–${Math.round(box.right)}px of ${viewportWidth}px)`;
  return null;
}

/**
 * The send control, measured by what a tap on it would HIT. Sideways overflow
 * was the only fit check here, and it passed while production had Send under
 * "Made with Loki" on a 390×760 phone (2026-10-17): the panel fit, the button
 * did not. `hit` is the element at the button's centre (null: nothing there).
 */
export function sendBlocked(
  send: { top: number; bottom: number; height: number },
  viewportHeight: number,
  hit: { isSend: boolean; label: string } | null,
): string | null {
  if (!send.height) return null;
  if (send.top < 0 || send.bottom > viewportHeight + 1)
    return `the send button is off the screen (${Math.round(send.top)}–${Math.round(send.bottom)}px of ${viewportHeight}px)`;
  if (!hit?.isSend)
    return `a tap on the send button lands on ${hit ? `“${hit.label}”` : "nothing"} instead`;
  return null;
}

const SAY: Record<Finding["kind"], string> = {
  error: "I hit an error of my own",
  request: "one of my calls to Loki failed",
  slow: "one of my calls to Loki was very slow",
  overflow: "my panel didn't fit this screen",
};

/**
 * Which call, in the owner's words. "One of my calls to Loki failed" named
 * nothing (owner, 2026-10-18: "I'm not even sure if it failed or not"): the
 * owner could not tell whether their note was saved or their question asked.
 */
const CALLS: Array<[RegExp, string, boolean]> = [
  // path, what it was doing, whether it carried the owner's own words
  [/\/api\/feedback\b/, "save your note", true],
  [/\/api\/widget\/owner\/build\b/, "start your builds", true],
  [/\/api\/widget\/(advise|chat|understand)\b/, "answer you", true],
  [/\/api\/widget\/transcribe\b/, "write down what you said", true],
  [/\/api\/widget\/owner\/changes\b/, "check on your changes", false],
  [/\/api\/widget-boot\b/, "finish loading", false],
];

/**
 * Reads the widget repeats on its own (the changes poll every half minute,
 * the boot check). One that fails once is asked again moments later and
 * nobody is the worse for it: a phone waking from its lock screen, a deploy
 * restarting the server, a tunnel. Only a read that keeps failing is a fault
 * worth telling Loki about — the owner was told "my call to Loki … failed"
 * for one dropped poll (2026-10-20).
 */
const BACKGROUND_READS: readonly RegExp[] = [
  /\/api\/widget\/owner\/changes\b/,
  /\/api\/widget-boot\b/,
];
/** Failures in a row before a background read counts as broken. */
export const BACKGROUND_FAILS = 3;

/** Which background read a URL is, if any (its pattern's source). */
export function backgroundRead(url: string): string | null {
  return BACKGROUND_READS.find((re) => re.test(url))?.source ?? null;
}

/**
 * Fold one finished background read into its failure streak. `report` is
 * true on the failure that completes the streak, and only then.
 */
export function nextReadStreak(
  streak: number,
  failed: boolean,
): { streak: number; report: boolean } {
  if (!failed) return { streak: 0, report: false };
  const next = streak + 1;
  return { streak: next, report: next === BACKGROUND_FAILS };
}

export function callInWords(detail: string | undefined): { doing: string; yours: boolean } | null {
  if (!detail) return null;
  const hit = CALLS.find(([re]) => re.test(detail));
  return hit ? { doing: hit[1], yours: hit[2] } : null;
}

export function selfSay(
  kind: Finding["kind"],
  sent: boolean,
  building = false,
  detail?: string,
): string {
  const call = kind === "request" || kind === "slow" ? callInWords(detail) : null;
  // "I couldn't check on your changes just now", not "my call to Loki to
  // read where your changes are failed" — a sentence the owner had to parse.
  const what = call
    ? kind === "slow"
      ? `asking Loki to ${call.doing} took far too long`
      : `I couldn't ${call.doing} just now`
    : SAY[kind];
  // A failed call that carried the owner's words is theirs to redo: the
  // note or the question is still in the panel, and one press sends it.
  const yours =
    call?.yours && kind === "request" ? " Your words are still here — press it again." : "";
  if (!sent)
    return `About me, not this page: ${what}. I couldn't send it to Loki just now.${yours}`;
  return building
    ? `About me, not this page: ${what}. I've started fixing it in Loki itself — it goes live by itself.${yours}`
    : `About me, not this page: ${what}. I've sent it to the people who build Loki${yours ? "." : " — nothing for you to do."}${yours}`;
}

const saidKey = (token: string) => `loki-self:${token}`;

function readSaid(token: string): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(saidKey(token)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeSaid(token: string, said: Set<string>): void {
  try {
    sessionStorage.setItem(saidKey(token), JSON.stringify([...said]));
  } catch {
    /* storage blocked: once per page view instead */
  }
}

export function installSelfWatch(opts: {
  apiBase: string;
  token: string;
  pass: () => string | null;
  /** The owner is watching right now. */
  active: () => boolean;
  /** Said in the conversation. */
  onFinding: (say: string) => void;
}): {
  /** A call from the widget to Loki finished (watch.ts hands these over). */
  ownRequest: (method: string, url: string, status: number | null, ms: number) => void;
  /** The panel has just opened and laid out. */
  checkPanel: (panel: HTMLElement) => void;
} {
  const said = readSaid(opts.token);
  let filed = 0;
  /** Failures in a row, per background read (BACKGROUND_READS). */
  const streaks = new Map<string, number>();
  const found = (f: Finding) => {
    const pass = opts.pass();
    if (!pass || !opts.active() || said.has(f.kind) || filed >= SELF_PER_PAGE) return;
    said.add(f.kind);
    writeSaid(opts.token, said);
    filed++;
    sendSelfReport(opts.apiBase, {
      token: opts.token,
      kind: f.kind,
      detail: f.detail,
      ownerPass: pass,
    })
      .then((r) => opts.onFinding(selfSay(f.kind, true, r.building, f.detail)))
      // Reporting a failure must not become a failure loop: the report call is
      // itself a call to Loki, and it is not handed back to ownRequest.
      .catch(() => opts.onFinding(selfSay(f.kind, false, false, f.detail)));
  };

  // Our own script, by its URL — the host's errors are Watch's business.
  const ours = (s: string | undefined) => !!s && s.includes("/widget.js");
  window.addEventListener("error", (e) => {
    if (!ours(e.filename)) return;
    const message = e.error instanceof Error ? e.error.message : e.message;
    if (message)
      found({ kind: "error", detail: `${message.slice(0, 300)} (${e.filename}:${e.lineno})` });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const err = e.reason instanceof Error ? e.reason : null;
    if (err && ours(err.stack)) found({ kind: "error", detail: err.message.slice(0, 300) });
  });

  return {
    ownRequest: (method, url, status, ms) => {
      // The report itself is not reported (see found()).
      if (url.includes("/api/widget/self-report")) return;
      const f = classifyOwnRequest(method, url, status, ms);
      const read = backgroundRead(url);
      if (read) {
        // A repeated read is a fault only when it keeps failing.
        const next = nextReadStreak(streaks.get(read) ?? 0, f?.kind === "request");
        streaks.set(read, next.streak);
        if (f?.kind === "request" && !next.report) return;
      }
      if (f) found(f);
    },
    checkPanel: (panel) => {
      const r = panel.getBoundingClientRect();
      if (!r.width) return;
      const detail = panelOverflow(
        {
          left: r.left,
          right: r.right,
          scrollWidth: panel.scrollWidth,
          clientWidth: panel.clientWidth,
        },
        window.innerWidth,
      );
      if (detail) return found({ kind: "overflow", detail });
      const send = panel.querySelector<HTMLElement>(".ck-send, .composer .go");
      if (!send) return;
      const b = send.getBoundingClientRect();
      const at = (panel.getRootNode() as ShadowRoot | Document).elementFromPoint?.(
        b.left + b.width / 2,
        b.top + b.height / 2,
      );
      const blocked = sendBlocked(
        b,
        window.innerHeight,
        at
          ? {
              isSend: at === send || send.contains(at),
              label: ((at as HTMLElement).innerText || at.className.toString() || at.tagName)
                .trim()
                .slice(0, 60),
            }
          : null,
      );
      if (blocked)
        found({
          kind: "overflow",
          detail: `${blocked} at ${window.innerWidth}×${window.innerHeight}`,
        });
    },
  };
}
