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
import { buildSuggestion } from "./report-payload";
import {
  failureSignature,
  watchReport,
  WATCH_REPORTS_PER_PAGE,
  describeControl,
  describeRequest,
  isFailedRequest,
  nextTapStreak,
  trailDiagnostics,
  type TapStreak,
  isNoiseError,
  pushTrail,
  type Failure,
  type TrailEntry,
} from "./watch-trail";

const pausedKey = (token: string) => `loki-watch-paused:${token}`;

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
  /** The widget's own calls to Loki — not the site's, so not recorded. */
  isOwnRequest: (url: string) => boolean;
  isActive: () => boolean;
  onFailure: (failure: Failure, trail: TrailEntry[]) => void;
}): { trail: () => TrailEntry[] } {
  let trail: TrailEntry[] = [];
  const add = (kind: TrailEntry["kind"], text: string) => {
    if (!opts.isActive()) return;
    trail = pushTrail(trail, { at: Date.now(), kind, text });
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

  const onRequest = (method: string, url: string, status: number | null) => {
    if (opts.isOwnRequest(new URL(url, location.href).href)) return;
    // The page answered the tap, so the button was not dead.
    streak = null;
    const text = describeRequest(method, url, status);
    if (isFailedRequest(status)) fail({ kind: "request", text });
    else if (!/^GET /.test(text)) add("request", text);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    // A request leaving is the page responding — even a slow one is not dead.
    if (!opts.isOwnRequest(new URL(url, location.href).href)) streak = null;
    try {
      const res = await originalFetch(input, init);
      onRequest(method, url, res.status);
      return res;
    } catch (err) {
      // An aborted request is the page changing its mind, not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError")) onRequest(method, url, null);
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
    this.addEventListener("loadend", () => {
      const [m, u] = this.__lokiReq ?? ["GET", ""];
      onRequest(m, u, this.status === 0 ? null : this.status);
    });
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  return { trail: () => trail };
}

export type WatchPillState =
  | { kind: "watching" }
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
  const btn = h("button", "wbtn");
  btn.addEventListener("click", onTogglePause);
  pill.append(dot, text, report, btn);
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
    switch (state.kind) {
      case "watching":
        text.textContent = "Loki is watching";
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
}): void {
  let paused = readWatchPaused(opts.token);
  const sent = new Set<string>();
  let reverting: ReturnType<typeof setTimeout> | null = null;
  let recorder: { trail: () => TrailEntry[] } | null = null;
  const pill = createWatchPill(
    opts.root,
    opts.theme,
    () => {
      paused = !paused;
      writeWatchPaused(opts.token, paused);
      pill.set({ kind: paused ? "paused" : "watching" });
    },
    () => {
      const loki = (window as unknown as { Loki?: { report: (i: object) => void } }).Loki;
      loki?.report({
        diagnostics: {
          "filed by": "Loki watch mode (Report)",
          ...trailDiagnostics(recorder?.trail() ?? [], Date.now()),
        },
      });
    },
  );
  if (paused) pill.set({ kind: "paused" });

  const report = async (failure: Failure, trail: TrailEntry[]) => {
    const pass = opts.pass();
    const signature = failureSignature(failure);
    if (!pass || sent.has(signature) || sent.size >= WATCH_REPORTS_PER_PAGE) return;
    sent.add(signature);
    if (reverting) clearTimeout(reverting);
    pill.set({ kind: "sending", what: failure.text });
    const { message, diagnostics } = watchReport(failure, trail, Date.now());
    try {
      const res = await fetch(`${opts.apiBase}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: opts.token,
          suggestion: buildSuggestion(message, diagnostics, SUGGESTION_MAX),
          page: location.pathname.slice(0, 300),
          url: location.href.slice(0, 1000),
          pageTitle: document.title.slice(0, 300) || undefined,
          scope: "page",
          ownerPass: pass,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      pill.set({ kind: "fixing", what: failure.text, followUrl: `${opts.apiBase}/feedback` });
      reverting = setTimeout(() => {
        if (!paused) pill.set({ kind: "watching" });
      }, FIXING_SHOWN_MS);
    } catch {
      pill.set({ kind: "not-sent", what: failure.text });
    }
  };

  recorder = installWatch({
    host: opts.host,
    isOwnRequest: (url) =>
      url.startsWith(`${opts.apiBase}/api/feedback`) ||
      url.startsWith(`${opts.apiBase}/api/widget`),
    isActive: () => !paused && opts.pass() !== null,
    onFailure: (failure, trail) => void report(failure, trail),
  });
}
