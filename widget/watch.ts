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
  noticeCount,
  sessionForReview,
  trailDiagnostics,
  type TapStreak,
  isNoiseError,
  pushTrail,
  type Failure,
  type TrailEntry,
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
  const notice = (kind: string, text: string) => {
    const n = noticed.get(kind) ?? 0;
    if (n >= NOTICES_PER_KIND) return;
    noticed.set(kind, n + 1);
    add("notice", text);
  };
  let streak: TapStreak = null;
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
    else if (isNoticeableRequest(status, ms))
      notice(
        status !== null && status >= 400 ? "4xx" : "slow",
        describeRequest(method, url, status, ms),
      );
    else if (!/^GET /.test(text)) add("request", text);
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

  observePerformance(notice);

  return { trail: () => trail };
}

/**
 * What the page feels like rather than what it does: how long it took to load,
 * the main thread freezing under a tap, content jumping as it loads. Each is
 * a remark (never a fix by itself), in words a non-engineer can read.
 */
function observePerformance(notice: (kind: string, text: string) => void): void {
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
  observe("longtask", (entries) => {
    for (const e of entries) {
      if (e.duration >= LONG_TASK_MS)
        notice(
          "longtask",
          `the page froze for ${Math.round(e.duration)}ms (taps go unanswered meanwhile)`,
        );
    }
  });
  let cls = 0;
  let clsNoted = false;
  observe("layout-shift", (entries) => {
    for (const e of entries as (PerformanceEntry & {
      value?: number;
      hadRecentInput?: boolean;
    })[]) {
      // A shift right after the person's own input is the page responding.
      if (!e.hadRecentInput) cls += e.value ?? 0;
    }
    if (!clsNoted && cls > CLS_POOR) {
      clsNoted = true;
      notice(
        "cls",
        `content jumped around while loading (layout shift ${cls.toFixed(2)}, poor above ${CLS_POOR})`,
      );
    }
  });
}

export type WatchPillState =
  | { kind: "watching"; noticed?: number }
  | { kind: "paused" }
  | { kind: "sending"; what: string }
  | { kind: "fixing"; what: string; followUrl: string }
  | { kind: "not-sent"; what: string };

/**
 * The always-visible sign that Loki is watching: a small pill at the top of
 * the page. It says what Loki is doing in plain words, and is the one place to
 * pause it — so nobody has to wonder whether they are being recorded.
 */
export function createWatchPill(
  root: ShadowRoot,
  theme: WidgetTheme,
  onTogglePause: () => void,
  onReport: () => void,
  onReview: (() => void) | null = null,
): { set: (state: WatchPillState) => void } {
  const style = h("style");
  style.textContent = `
.watch-pill {
  position: fixed; top: max(8px, env(safe-area-inset-top)); left: 12px; right: 12px; margin: 0 auto; width: max-content;
  z-index: 2147483646; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 24px);
  padding: 6px 6px 6px 12px; border-radius: 999px; border: 1px solid ${theme.borderStrong};
  background: ${theme.surfaceRaised}; color: ${theme.text}; font-size: 12px; line-height: 1.3;
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
}
.watch-pill .wdot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: ${theme.accent}; box-shadow: 0 0 0 3px ${theme.accentMuted}; animation: wpulse 2s ease-in-out infinite; }
.watch-pill.paused .wdot { background: ${theme.textMuted}; box-shadow: none; animation: none; }
.watch-pill.alert .wdot { background: ${theme.error}; box-shadow: 0 0 0 3px ${theme.errorSurface}; }
.watch-pill .wtext { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.watch-pill .wtext a { color: inherit; text-decoration: underline; }
.watch-pill .wbtn + .wbtn { margin-left: -4px; }
.watch-pill .wbtn { flex: none; min-height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid ${theme.border}; color: ${theme.textSecondary}; font-size: 11px; }
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
  // Not everything wrong throws an error: Report opens the note with the same
  // trail attached, for "this looks wrong" that no listener can see.
  const report = h("button", "wbtn", "Report");
  report.addEventListener("click", onReport);
  // Review: what Loki makes of what you just did — errors, design,
  // engineering, process, product — each change one tap from being built.
  const review = onReview ? h("button", "wbtn primary", "Review") : null;
  if (review && onReview) {
    review.title = "Loki reviews what you just did on this site and suggests improvements";
    review.addEventListener("click", onReview);
  }
  const btn = h("button", "wbtn");
  btn.addEventListener("click", onTogglePause);
  pill.append(dot, text, ...(review ? [review] : []), report, btn);
  root.append(style, pill);

  const set = (state: WatchPillState) => {
    pill.className = `watch-pill${state.kind === "paused" ? " paused" : ""}${
      state.kind === "sending" || state.kind === "fixing" || state.kind === "not-sent"
        ? " alert"
        : ""
    }`;
    text.textContent = "";
    // The words fit a phone; what exactly broke is one hover away.
    pill.title = "what" in state ? state.what : "";
    btn.textContent = state.kind === "paused" ? "Resume" : "Pause";
    report.style.display = state.kind === "paused" ? "none" : "";
    if (review) review.style.display = state.kind === "paused" ? "none" : "";
    switch (state.kind) {
      case "watching":
        // The count is the invitation: something is worth a look, and Review
        // is the button beside it. No model runs until it is pressed.
        text.textContent = state.noticed
          ? `Loki is watching · noticed ${state.noticed}`
          : "Loki is watching";
        break;
      case "paused":
        text.textContent = "Loki paused — nothing recorded";
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
        text.textContent = "Something broke — couldn't reach Loki. Report it with the button.";
        break;
    }
  };
  set({ kind: "watching" });
  return { set };
}

/** The ingest's cap on `suggestion` (api/feedback FeedbackBody). */
const SUGGESTION_MAX = 2000;

/** How long "Loki is fixing …" stays before the pill says "watching" again. */
const FIXING_SHOWN_MS = 30_000;

/**
 * Watch mode, whole: the pill, pause/resume, the recorder, and the report a
 * failure files. A failure files at most once per distinct cause and at most
 * WATCH_REPORTS_PER_PAGE times per page load — one broken request retried in a
 * loop must not start forty builds.
 */
export function startWatchMode(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  theme: WidgetTheme;
  token: string;
  apiBase: string;
  /** The owner pass as it stands now (null once the server refuses it). */
  pass: () => string | null;
  /**
   * Review pressed: hand Loki the session (what they did + the page checks).
   * Null where the panel has no Ask view to answer in — then the pill has no
   * Review button rather than one that does nothing.
   */
  onReview?: ((session: string) => void) | null;
}): WatchSession {
  let paused = readWatchPaused(opts.token);
  const sent = new Set<string>();
  let reverting: ReturnType<typeof setTimeout> | null = null;
  let recorder: { trail: () => TrailEntry[] } | null = null;
  const watching = (): WatchPillState => ({
    kind: "watching",
    noticed: noticeCount(recorder?.trail() ?? []),
  });
  const session = () => sessionForReview(recorder?.trail() ?? [], safePageChecks(), Date.now());
  const pill = createWatchPill(
    opts.root,
    opts.theme,
    () => {
      paused = !paused;
      writeWatchPaused(opts.token, paused);
      show(paused ? { kind: "paused" } : watching());
    },
    () => {
      const loki = (window as unknown as { Loki?: { report: (i: object) => void } }).Loki;
      loki?.report({ diagnostics: diagnostics("Loki watch mode (Report)") });
    },
    opts.onReview ? () => opts.onReview?.(session()) : null,
  );
  /** What the pill shows now — a new remark updates the count only while it
   *  says "watching", never over "Something broke — Loki is fixing it". */
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

  const report = async (failure: Failure, trail: TrailEntry[]) => {
    const pass = opts.pass();
    const signature = failureSignature(failure);
    if (!pass || sent.has(signature) || sent.size >= WATCH_REPORTS_PER_PAGE) return;
    sent.add(signature);
    if (reverting) clearTimeout(reverting);
    show({ kind: "sending", what: failure.text });
    const { message, diagnostics } = watchReport(failure, trail, Date.now());
    try {
      await sendReport(opts.apiBase, {
        token: opts.token,
        suggestion: buildSuggestion(message, diagnostics, SUGGESTION_MAX),
        scope: "page",
        ownerPass: pass,
      });
      show({ kind: "fixing", what: failure.text, followUrl: `${opts.apiBase}/feedback` });
      reverting = setTimeout(() => {
        if (!paused) show(watching());
      }, FIXING_SHOWN_MS);
    } catch {
      show({ kind: "not-sent", what: failure.text });
    }
  };

  recorder = installWatch({
    host: opts.host,
    token: opts.token,
    isOwnRequest: (url) =>
      url.startsWith(`${opts.apiBase}/api/feedback`) ||
      url.startsWith(`${opts.apiBase}/api/widget`),
    isActive: () => !paused && opts.pass() !== null,
    onFailure: (failure, trail) => void report(failure, trail),
    onChange: () => {
      if (shown === "watching") show(watching());
    },
  });
  // A trail restored from the previous page of this visit may already hold
  // remarks; say so from the first paint.
  if (!paused) show(watching());

  return {
    session,
    diagnostics: () => (paused ? null : diagnostics("Loki watch mode (Review)")),
  };
}

export type WatchSession = {
  /** What Review sends: the trail and the page checks, as text. */
  session: () => string;
  /** The trail as report lines, for a change requested out of a Review —
   *  null while paused, when nothing may travel. */
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
