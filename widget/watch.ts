/**
 * Watch mode in the page: the listeners that keep the trail, and the pill
 * that says, the whole time, that Loki is watching.
 *
 * Owner only — main.ts starts it when this browser holds the owner pass from
 * Loki's "Open your site" link — and never silent: while it records, the pill
 * is on screen; one tap pauses it, and paused it records nothing. The trail
 * and what counts as a failure are watch-trail.ts (pure, tested).
 */
import { h } from "./dom";
import type { WidgetTheme } from "./theme";
import { buildSuggestion, type ReportDiagnostics } from "./report-payload";
import {
  failureSignature,
  watchReport,
  WATCH_REPORTS_PER_PAGE,
  describeControl,
  describeRequest,
  freshTrail,
  isFailedRequest,
  isNoticeableRequest,
  nextTapStreak,
  explainChecks,
  explainNotice,
  noticeSignature,
  sessionForReview,
  SLOW_REQUEST_MS,
  trailDiagnostics,
  type TapStreak,
  isNoiseError,
  pushTrail,
  type Failure,
  type Notice,
  type NoticeKind,
  type TrailEntry,
  checksSignature,
} from "./watch-trail";
import { runPageChecks } from "./page-checks";
import { sendReport } from "./send-report";

const pausedKey = (token: string) => `loki-watch-paused:${token}`;
/** Per tab, per site: a multi-page site reloads on every link, and Review must
 *  still see the whole visit. sessionStorage dies with the tab, which is the
 *  right lifetime for "what I just did". */
const trailKey = (token: string) => `loki-watch-trail:${token}`;

function readStoredTrail(token: string): TrailEntry[] {
  try {
    return freshTrail(JSON.parse(sessionStorage.getItem(trailKey(token)) ?? "[]"), Date.now());
  } catch {
    return [];
  }
}

function writeStoredTrail(token: string, trail: TrailEntry[]): void {
  try {
    sessionStorage.setItem(trailKey(token), JSON.stringify(trail));
  } catch {
    /* storage blocked or full: the trail lasts for this page view */
  }
}

/** Long tasks shorter than this are not felt; longer ones freeze taps. */
const LONG_TASK_MS = 300;
/** Remarks of one kind per page view, at most — a janky page must not fill
 *  the whole trail with "froze 320ms". */
const NOTICES_PER_KIND = 3;
/** Cumulative Layout Shift above this is "poor" by Google's own threshold. */
const CLS_POOR = 0.1;
/** A page that takes longer than this to load has lost some of its visitors. */
const SLOW_LOAD_MS = 3_000;
/** A remark names the tap that led to it when that tap was this recent. */
const TAP_LEADS_MS = 5_000;

export function readWatchPaused(token: string): boolean {
  try {
    return localStorage.getItem(pausedKey(token)) === "1";
  } catch {
    return false;
  }
}

export function writeWatchPaused(token: string, paused: boolean): void {
  try {
    if (paused) localStorage.setItem(pausedKey(token), "1");
    else localStorage.removeItem(pausedKey(token));
  } catch {
    /* private mode: the choice lasts for this page view */
  }
}

/**
 * Start recording. `ownOrigin` requests (the widget talking to Loki) are not
 * the site's and are left out. `isActive` is read on every event, so pausing
 * stops recording at once without unhooking anything.
 */
export function installWatch(opts: {
  host: HTMLElement;
  /** Keys the trail kept across this tab's page loads. */
  token: string;
  /** The widget's own calls to Loki — not the site's, so not recorded. */
  isOwnRequest: (url: string) => boolean;
  isActive: () => boolean;
  onFailure: (failure: Failure, trail: TrailEntry[]) => void;
  /** Something new went into the trail (the pill keeps its count from this). */
  onChange?: (trail: TrailEntry[]) => void;
  /** A remark worth saying out loud — Loki tells the owner in the thread. */
  onNotice?: (notice: Notice) => void;
  /** The site moved to another page (SPA navigation) — time to look at it. */
  onPage?: () => void;
}): { trail: () => TrailEntry[] } {
  let trail: TrailEntry[] = readStoredTrail(opts.token);
  const add = (kind: TrailEntry["kind"], text: string) => {
    if (!opts.isActive()) return;
    const next = pushTrail(trail, { at: Date.now(), kind, text });
    if (next === trail) return;
    trail = next;
    writeStoredTrail(opts.token, trail);
    opts.onChange?.(trail);
  };
  const noticed = new Map<string, number>();
  /** A remark, rationed per kind per page view (see NOTICES_PER_KIND). */
  const notice = (kind: NoticeKind, text: string) => {
    if (!opts.isActive()) return;
    const n = noticed.get(kind) ?? 0;
    if (n >= NOTICES_PER_KIND) return;
    noticed.set(kind, n + 1);
    add("notice", text);
    // Name the tap that led here when it was a moment ago; a freeze already
    // names its own tap in the text.
    const recent = lastTap && performance.now() - lastTap.at < TAP_LEADS_MS;
    opts.onNotice?.({ kind, text, after: kind !== "longtask" && recent ? lastTap?.what : null });
  };
  let streak: TapStreak = null;
  /** The last tap on the site (performance clock) — a freeze right after it
   *  is one the person felt (see observePerformance). */
  let lastTap: { at: number; what: string } | null = null;
  const fail = (failure: Failure) => {
    if (!opts.isActive()) return;
    // A dead tap is already in the trail as the tap itself.
    if (failure.kind !== "dead-tap")
      add(failure.kind === "request" ? "request" : "error", failure.text);
    opts.onFailure(failure, trail);
  };

  add("page", location.pathname);
  let lastPath = location.pathname;
  const notePage = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    streak = null;
    noticed.clear();
    add("page", location.pathname);
    opts.onPage?.();
  };
  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name];
    history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const out = original.apply(this, args);
      notePage();
      return out;
    } as History["pushState"];
  }
  window.addEventListener("popstate", notePage);

  document.addEventListener(
    "click",
    (e) => {
      if (e.composedPath().includes(opts.host)) return;
      const target = e.target instanceof Element ? e.target : null;
      const el =
        target?.closest("button,a,[role=button],input,select,textarea,label,summary") ?? target;
      if (!el) return;
      const tap = describeControl({
        tag: el.tagName,
        role: el.getAttribute("role"),
        type: el.getAttribute("type"),
        label: el.getAttribute("aria-label"),
        // Text of a control, never the value of a field.
        text:
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? null
            : el.textContent,
        placeholder: el.getAttribute("placeholder"),
      });
      add("tap", tap);
      lastTap = { at: e.timeStamp, what: tap };
      if (!opts.isActive()) return;
      const next = nextTapStreak(streak, tap, Date.now());
      streak = next.streak;
      if (next.dead) fail({ kind: "dead-tap", text: tap });
    },
    true,
  );

  window.addEventListener("error", (e) => {
    const message = e.error instanceof Error ? e.error.message : e.message;
    if (!message || isNoiseError(message)) return;
    if (e.filename && e.filename.includes("widget.js")) return;
    fail({ kind: "error", text: message });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
    if (!reason || isNoiseError(reason)) return;
    fail({ kind: "error", text: reason });
  });

  const onRequest = (method: string, url: string, status: number | null, ms: number) => {
    if (opts.isOwnRequest(new URL(url, location.href).href)) return;
    // The page answered the tap, so the button was not dead.
    streak = null;
    const text = describeRequest(method, url, status);
    if (isFailedRequest(status)) fail({ kind: "request", text });
    else if (isNoticeableRequest(status, ms)) {
      const slow = ms >= SLOW_REQUEST_MS;
      // The duration is only news when it was slow; "404 in 0.0s" is noise.
      notice(slow ? "slow" : "4xx", describeRequest(method, url, status, slow ? ms : undefined));
    } else if (!/^GET /.test(text)) add("request", text);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    // A request leaving is the page responding — even a slow one is not dead.
    if (!opts.isOwnRequest(new URL(url, location.href).href)) streak = null;
    const started = performance.now();
    try {
      const res = await originalFetch(input, init);
      onRequest(method, url, res.status, performance.now() - started);
      return res;
    } catch (err) {
      // An aborted request is the page changing its mind, not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError"))
        onRequest(method, url, null, performance.now() - started);
      throw err;
    }
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { __lokiReq?: [string, string] },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__lokiReq = [method, String(url)];
    if (!opts.isOwnRequest(new URL(String(url), location.href).href)) streak = null;
    const started = performance.now();
    this.addEventListener("loadend", () => {
      const [m, u] = this.__lokiReq ?? ["GET", ""];
      onRequest(m, u, this.status === 0 ? null : this.status, performance.now() - started);
    });
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  // The site's own console.error: what its developers already know is wrong
  // and left in. Never a fix by itself — frameworks log warnings here too —
  // but a reviewer reading it next to the tap that caused it learns a lot.
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    try {
      const first = args[0] instanceof Error ? args[0].message : String(args[0] ?? "");
      if (first && !first.startsWith("[loki-widget]") && !isNoiseError(first))
        notice("console", `console error: ${first.slice(0, 140)}`);
    } catch {
      /* never let recording break the site's own logging */
    }
  };

  observePerformance(notice, opts.host, () => lastTap);

  return { trail: () => trail };
}

/** A freeze this soon after a tap on the site is one the person felt. */
const FELT_FREEZE_WINDOW_MS = 1_000;

function isOurNode(node: Node | null | undefined, host: HTMLElement): boolean {
  if (!node) return false;
  const root = node.getRootNode();
  return node === host || host.contains(node) || (root instanceof ShadowRoot && root.host === host);
}

/**
 * What the page feels like rather than what it does: how long it took to load,
 * the main thread freezing under a tap, content jumping as it loads. Each is
 * a remark (never a fix by itself), in words a non-engineer can read.
 */
function observePerformance(
  notice: (kind: NoticeKind, text: string) => void,
  host: HTMLElement,
  lastTap: () => { at: number; what: string } | null,
): void {
  const nav = () => {
    const entry = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (!entry || !entry.loadEventEnd) return;
    const ms = entry.loadEventEnd - entry.startTime;
    if (ms >= SLOW_LOAD_MS) notice("load", `this page took ${(ms / 1000).toFixed(1)}s to load`);
  };
  if (document.readyState === "complete") setTimeout(nav, 0);
  else window.addEventListener("load", () => setTimeout(nav, 0), { once: true });

  const observe = (type: string, onEntries: (list: PerformanceEntryList) => void) => {
    try {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
      new PerformanceObserver((list) => onEntries(list.getEntries())).observe({
        type,
        buffered: true,
      });
    } catch {
      /* an older browser: one signal fewer, nothing broken */
    }
  };
  // Only a freeze that answers a tap on the SITE counts. A long task carries
  // no script attribution, so one during load could be anyone's — including
  // this widget booting, or Review reading the page — and a reviewer that
  // blames the site for Loki's own work is worse than one that says nothing.
  observe("longtask", (entries) => {
    const tap = lastTap();
    for (const e of entries) {
      if (e.duration < LONG_TASK_MS || !tap) continue;
      // Overlap, not "starts after": the task that RUNS the tap handler began
      // a moment before this listener saw the tap.
      const overlaps =
        e.startTime + e.duration >= tap.at && e.startTime <= tap.at + FELT_FREEZE_WINDOW_MS;
      if (overlaps)
        notice(
          "longtask",
          `after ${tap.what} the page froze for ${Math.round(e.duration)}ms (taps go unanswered meanwhile)`,
        );
    }
  });
  let cls = 0;
  let clsNoted = false;
  observe("layout-shift", (entries) => {
    for (const e of entries as (PerformanceEntry & {
      value?: number;
      hadRecentInput?: boolean;
      sources?: { node?: Node | null }[];
    })[]) {
      // A shift right after the person's own input is the page responding.
      // Only shifts the browser can pin on a node of the SITE count: Chrome
      // reports Loki's own panel (shadow DOM) with a null node, and opening
      // Review once scored 0.27 against a page that never moved.
      const site = (e.sources ?? []).some((s) => s.node && !isOurNode(s.node, host));
      if (!e.hadRecentInput && site) cls += e.value ?? 0;
    }
    if (!clsNoted && cls > CLS_POOR) {
      clsNoted = true;
      notice(
        "cls",
        `content jumped around on this page (layout shift ${cls.toFixed(2)}, poor above ${CLS_POOR})`,
      );
    }
  });
}

export type WatchPillState =
  | { kind: "watching"; latest?: string }
  | { kind: "paused" }
  | { kind: "sending"; what: string }
  | { kind: "fixing"; what: string; followUrl: string }
  | { kind: "not-sent"; what: string };

/**
 * The always-visible sign that Loki is watching: a bar at the top of the page.
 * It says in plain words what Loki is doing — and, the moment it notices
 * something, what that was — with Show (open the conversation where Loki said
 * it) and Stop watching. Nobody has to wonder whether they are being recorded,
 * or hunt for how to stop it.
 */
export function createWatchPill(
  root: ShadowRoot,
  theme: WidgetTheme,
  onToggle: () => void,
  onShow: () => void,
): { set: (state: WatchPillState) => void; setVisible: (visible: boolean) => void } {
  const style = h("style");
  style.textContent = `
.watch-pill {
  position: fixed; top: max(8px, env(safe-area-inset-top)); left: 12px; right: 12px; margin: 0 auto; width: max-content;
  z-index: 2147483646; display: flex; align-items: center; gap: 8px; max-width: min(560px, calc(100vw - 24px));
  padding: 6px 6px 6px 12px; border-radius: 999px; border: 1px solid ${theme.borderStrong};
  background: ${theme.surfaceRaised}; color: ${theme.text}; font-size: 12px; line-height: 1.3;
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
}
.watch-pill .wdot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: ${theme.accent}; box-shadow: 0 0 0 3px ${theme.accentMuted}; animation: wpulse 2s ease-in-out infinite; }
.watch-pill.paused .wdot { background: ${theme.textMuted}; box-shadow: none; animation: none; }
.watch-pill.alert .wdot { background: ${theme.error}; box-shadow: 0 0 0 3px ${theme.errorSurface}; }
.watch-pill.said { border-color: ${theme.accent}; }
.watch-pill .wtext { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.watch-pill .wtext a { color: inherit; text-decoration: underline; }
.watch-pill .wbtn + .wbtn { margin-left: -4px; }
.watch-pill .wbtn { flex: none; min-height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid ${theme.border}; color: ${theme.textSecondary}; font-size: 11px; white-space: nowrap; }
.watch-pill .wbtn.primary { border-color: ${theme.accent}; background: ${theme.accentMuted}; color: ${theme.text}; font-weight: 600; }
@media (pointer: coarse) { .watch-pill .wbtn { min-height: 32px; } }
@keyframes wpulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .watch-pill .wdot { animation: none; } }
`;
  const pill = h("div", "watch-pill");
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");
  const dot = h("span", "wdot");
  const text = h("span", "wtext");
  const showBtn = h("button", "wbtn", "Show");
  showBtn.title = "Open the conversation with Loki";
  showBtn.addEventListener("click", onShow);
  const toggle = h("button", "wbtn");
  toggle.addEventListener("click", onToggle);
  pill.append(dot, text, showBtn, toggle);
  root.append(style, pill);

  const set = (state: WatchPillState) => {
    const said = state.kind === "watching" && !!state.latest;
    pill.className = `watch-pill${state.kind === "paused" ? " paused" : ""}${said ? " said" : ""}${
      state.kind === "sending" || state.kind === "fixing" || state.kind === "not-sent"
        ? " alert"
        : ""
    }`;
    text.textContent = "";
    pill.title = "what" in state ? state.what : said ? (state.latest ?? "") : "";
    toggle.textContent = state.kind === "paused" ? "Watch again" : "Stop watching";
    showBtn.classList.toggle("primary", said || state.kind === "fixing");
    switch (state.kind) {
      case "watching":
        text.textContent = state.latest
          ? `Loki noticed: ${state.latest}`
          : "Loki is watching you use this site";
        break;
      case "paused":
        text.textContent = "Loki stopped watching — nothing is recorded";
        break;
      case "sending":
        text.textContent = "Something broke — telling Loki…";
        break;
      case "fixing": {
        text.append("Something broke — Loki is fixing it · ");
        const a = h("a", undefined, "Follow");
        a.href = state.followUrl;
        a.target = "_blank";
        a.rel = "noopener";
        text.append(a);
        break;
      }
      case "not-sent":
        text.textContent = "Something broke — couldn't reach Loki. Tap Show to send it.";
        break;
    }
  };
  set({ kind: "watching" });
  return {
    set,
    setVisible: (visible: boolean) => {
      pill.style.display = visible ? "" : "none";
    },
  };
}

/** The ingest's cap on `suggestion` (api/feedback FeedbackBody). */
const SUGGESTION_MAX = 2000;

/** How long "Loki is fixing …" stays before the pill goes back to watching. */
const FIXING_SHOWN_MS = 30_000;
/** Let the page settle (fonts, late images) before Loki looks at it. */
const CHECKS_DELAY_MS = 2_500;

/** What Loki says in the conversation when it noticed something. */
export type Remark = {
  say: string;
  fix: string;
  filed?: boolean;
  /** The bar's one line. */ short?: string;
};

const saidKey = (token: string) => `loki-watch-said:${token}`;

/** Remarks already made this visit — a reload must not repeat them. */
function readSaid(token: string): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(saidKey(token)) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSaid(token: string, said: Set<string>): void {
  try {
    sessionStorage.setItem(saidKey(token), JSON.stringify([...said].slice(-100)));
  } catch {
    /* storage blocked: Loki may repeat itself after a reload, nothing worse */
  }
}

/** A failure, in the owner's words (watch files the fix itself). */
function failureSay(f: Failure): string {
  return f.kind === "dead-tap"
    ? `You tapped ${f.text} three times and nothing happened.`
    : f.kind === "request"
      ? `Something broke: the page asked for ${f.text.replace(/^[A-Z]+ /, "").replace(/ → /, " and got ")}.`
      : `Something broke: the page hit an error — “${f.text}”.`;
}

/**
 * Watch mode, whole: the bar, stop/start, the recorder, the fix a failure
 * files, and the remarks Loki makes out loud. A failure files at most once per
 * distinct cause and at most WATCH_REPORTS_PER_PAGE times per page load — one
 * broken request retried in a loop must not start forty builds. A remark is
 * made once per visit (signatures kept per tab), so reloading a page with a
 * known problem does not repeat it.
 */
export function startWatchMode(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  theme: WidgetTheme;
  token: string;
  apiBase: string;
  /** The owner pass as it stands now (null once the server refuses it). */
  pass: () => string | null;
  /** Show on the bar: open the conversation. */
  onShow: () => void;
  /** Loki noticed something — say it in the conversation. */
  onRemark: (remark: Remark) => void;
  /** True while the launcher or the open panel already shows that Loki is
   *  watching — then the top bar stays out of the site's way. */
  statusShown: () => boolean;
  /** Stopped or started again — the panel's header follows. */
  onChange?: () => void;
}): WatchSession {
  let paused = readWatchPaused(opts.token);
  const sent = new Set<string>();
  const said = readSaid(opts.token);
  let latest: string | undefined;
  let reverting: ReturnType<typeof setTimeout> | null = null;
  let recorder: { trail: () => TrailEntry[] } | null = null;
  const watching = (): WatchPillState => ({ kind: "watching", latest });
  const session = () => sessionForReview(recorder?.trail() ?? [], safePageChecks(), Date.now());
  const setPaused = (value: boolean) => {
    paused = value;
    writeWatchPaused(opts.token, paused);
    if (!paused) latest = undefined;
    show(paused ? { kind: "paused" } : watching());
    opts.onChange?.();
    if (!paused) scheduleChecks();
  };
  const pill = createWatchPill(opts.root, opts.theme, () => setPaused(!paused), opts.onShow);
  // The bar is the fallback, not the main signal: shown only when neither the
  // launcher nor the open panel can say that Loki is watching (a page that
  // blocks every corner, or one that hides the launcher). Re-checked each
  // second — the launcher hides and returns as the page changes under it.
  const syncBar = () => pill.setVisible(!opts.statusShown());
  syncBar();
  window.setInterval(syncBar, 1000);
  /** What the pill shows now — a remark never covers "Loki is fixing it". */
  let shown: WatchPillState["kind"] = "watching";
  const show = (state: WatchPillState) => {
    shown = state.kind;
    pill.set(state);
  };
  show(paused ? { kind: "paused" } : watching());
  const diagnostics = (filedBy: string) => ({
    "filed by": filedBy,
    ...trailDiagnostics(recorder?.trail() ?? [], Date.now()),
  });

  /** Say it once per visit: in the conversation, and on the bar. */
  const remark = (signature: string, r: Remark) => {
    if (paused || said.has(signature)) return;
    said.add(signature);
    writeSaid(opts.token, said);
    opts.onRemark(r);
    latest = r.short ?? r.say.split("\n")[0];
    if (shown === "watching") show(watching());
  };

  const report = async (failure: Failure, trail: TrailEntry[]) => {
    const pass = opts.pass();
    const signature = failureSignature(failure);
    if (!pass || sent.has(signature) || sent.size >= WATCH_REPORTS_PER_PAGE) return;
    sent.add(signature);
    if (reverting) clearTimeout(reverting);
    show({ kind: "sending", what: failure.text });
    const { message, diagnostics } = watchReport(failure, trail, Date.now());
    let filed = false;
    try {
      await sendReport(opts.apiBase, {
        token: opts.token,
        suggestion: buildSuggestion(message, diagnostics, SUGGESTION_MAX),
        scope: "page",
        ownerPass: pass,
      });
      filed = true;
      show({ kind: "fixing", what: failure.text, followUrl: `${opts.apiBase}/feedback` });
      reverting = setTimeout(() => {
        if (!paused) show(watching());
      }, FIXING_SHOWN_MS);
    } catch {
      show({ kind: "not-sent", what: failure.text });
    }
    remark(`${location.pathname}|fail|${signature}`, {
      say: filed
        ? `${failureSay(failure)} I've started a fix — it goes live by itself.`
        : `${failureSay(failure)} I couldn't reach Loki to fix it — send it from here.`,
      fix: message,
      filed,
    });
  };

  // Look at each page once it has settled: what a visitor pays for that
  // nobody sees (unnamed buttons, tiny targets, broken images…).
  let checksTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleChecks = () => {
    if (checksTimer) clearTimeout(checksTimer);
    checksTimer = setTimeout(() => {
      const checks = safePageChecks();
      const r = explainChecks(checks);
      if (r) remark(checksSignature(location.pathname, checks), r);
    }, CHECKS_DELAY_MS);
  };

  recorder = installWatch({
    host: opts.host,
    token: opts.token,
    isOwnRequest: (url) =>
      url.startsWith(`${opts.apiBase}/api/feedback`) ||
      url.startsWith(`${opts.apiBase}/api/widget`),
    isActive: () => !paused && opts.pass() !== null,
    onFailure: (failure, trail) => void report(failure, trail),
    onNotice: (n) => remark(noticeSignature(location.pathname, n), explainNotice(n)),
    onPage: scheduleChecks,
  });
  if (!paused) {
    show(watching());
    scheduleChecks();
  }

  return {
    on: () => !paused && opts.pass() !== null,
    stop: () => setPaused(true),
    resume: () => setPaused(false),
    session,
    diagnostics: () => (paused ? null : diagnostics("Loki watch mode")),
  };
}

export type WatchSession = {
  /** Recording right now: the owner's pass holds and they have not stopped it. */
  on: () => boolean;
  stop: () => void;
  resume: () => void;
  /** What Review sends: the trail and the page checks, as text. */
  session: () => string;
  /** The trail as report lines, for a change sent while watching — null when
   *  stopped, when nothing may travel. */
  diagnostics: () => ReportDiagnostics | null;
};

/** Page checks must never take the review down with them. */
function safePageChecks(): string[] {
  try {
    return runPageChecks(document);
  } catch {
    return [];
  }
}
