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

const SAY: Record<Finding["kind"], string> = {
  error: "I hit an error of my own",
  request: "one of my calls to Loki failed",
  slow: "one of my calls to Loki was very slow",
  overflow: "my panel didn't fit this screen",
};

export function selfSay(kind: Finding["kind"], sent: boolean): string {
  return sent
    ? `About me, not this page: ${SAY[kind]}. I've sent it to the people who build Loki — nothing for you to do.`
    : `About me, not this page: ${SAY[kind]}. I couldn't send it to Loki just now.`;
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
      .then(() => opts.onFinding(selfSay(f.kind, true)))
      // Reporting a failure must not become a failure loop: the report call is
      // itself a call to Loki, and it is not handed back to ownRequest.
      .catch(() => opts.onFinding(selfSay(f.kind, false)));
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
      if (detail) found({ kind: "overflow", detail });
    },
  };
}
