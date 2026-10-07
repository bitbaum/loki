/**
 * "Watch the fix" — Loki walks the owner through a shipped change ON the live
 * site, the way a developer would show it: a cursor glides to each part,
 * a caption says why it went there, a safe control gets clicked. If a step
 * cannot be shown (the element is gone, hidden, zero-sized), the tour says so
 * in plain words and tells Loki, which files it for investigation — the tour
 * is also the first live check that the fix is really there.
 *
 * Why here and not in Loki: a cross-origin iframe cannot be scrolled, pointed
 * at or clicked. This bundle already runs on every fleet site, same-origin
 * with the page, so it is the one place the walkthrough can actually happen.
 *
 * Entry: Loki's "Watch the fix" opens the live page with `#loki-tour=<token>`.
 * The fragment never reaches the site's server; the token is signed by Loki,
 * scoped to one feedback item, and expires. Nothing else starts a tour.
 */
import { h } from "./dom";
import type { WidgetTheme } from "./theme";

export const TOUR_HASH_KEY = "loki-tour";

/** Fields sent to Loki per candidate element; mirrors the route's caps. */
export const TOUR_OUTLINE_MAX = 120;
const TEXT_MAX = 90;

export type TourOutlineItem = { i: number; tag: string; text: string; id?: string };

export type TourStep = {
  /** Index into the outline this browser sent, or null for a page-level beat. */
  target: number | null;
  /** A CSS selector (the element the visitor picked) when there is no index. */
  selector?: string | null;
  action: "point" | "click" | "scroll";
  say: string;
};

type TourPlan = {
  ok: true;
  theme: WidgetTheme;
  title: string;
  intro: string;
  steps: TourStep[];
  outro: string;
  lokiHref: string | null;
  prUrl: string | null;
};

/** The owner's link: the live page with the tour token in the fragment. */
export function tourSiteUrl(pageUrl: string, token: string): string {
  const base = pageUrl.split("#")[0];
  return `${base}#${TOUR_HASH_KEY}=${encodeURIComponent(token)}`;
}

/** Read the tour token from the fragment and clean it out of the address bar,
 *  so a copied link does not hand the tour to someone else. */
export function takeTourToken(): string | null {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return null;
  let token: string | null = null;
  const kept: string[] = [];
  for (const part of raw.split("&")) {
    const [k, v] = part.split("=");
    if (k === TOUR_HASH_KEY && v) {
      try {
        token = decodeURIComponent(v);
      } catch {
        token = null;
      }
    } else if (part) kept.push(part);
  }
  if (!token) return null;
  try {
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search + (kept.length ? `#${kept.join("&")}` : ""),
    );
  } catch {
    /* sandboxed frame */
  }
  return token;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function shown(el: Element): boolean {
  if (el.closest("#loki-feedback-host, #loki-tour-host")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.02;
}

const CANDIDATES =
  "h1,h2,h3,h4,a[href],button,[role=button],input,select,textarea,summary,img[alt],video,nav,header,footer,form,section[id],[id]:is(section,div,article)";

/** What Loki may point at: visible landmarks, headings and controls, each with
 *  the words a person would use for it. Built in document order, so "the
 *  bottom of the page" is the end of the list. */
export function buildTourOutline(): { items: TourOutlineItem[]; els: Element[] } {
  const items: TourOutlineItem[] = [];
  const els: Element[] = [];
  for (const el of Array.from(document.querySelectorAll(CANDIDATES))) {
    if (items.length >= TOUR_OUTLINE_MAX) break;
    if (!shown(el)) continue;
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("placeholder") ||
      (tag === "nav" || tag === "header" || tag === "footer" || tag === "form" || tag === "section"
        ? clean((el as HTMLElement).innerText).slice(0, 60)
        : clean((el as HTMLElement).innerText || el.textContent));
    const href = tag === "a" ? el.getAttribute("href") : null;
    const text = clean(`${label}${href ? ` → ${href}` : ""}`).slice(0, TEXT_MAX);
    if (!text && tag !== "footer" && tag !== "header" && tag !== "nav") continue;
    const item: TourOutlineItem = { i: items.length, tag, text };
    if (el.id) item.id = el.id.slice(0, 40);
    items.push(item);
    els.push(el);
  }
  return { items, els };
}

/** Only controls that stay on this page are really clicked: an in-page anchor,
 *  a disclosure, a plain button. Anything that would navigate away or submit a
 *  form is pointed at and "tapped" visually, never fired. */
function safeToClick(el: Element): boolean {
  if (el instanceof HTMLAnchorElement) {
    const href = el.getAttribute("href") ?? "";
    return href.startsWith("#") && !el.target;
  }
  if (el.tagName === "SUMMARY") return true;
  if (el instanceof HTMLButtonElement) return el.type === "button" && !el.closest("form");
  return false;
}

/** How far the caption must rise to clear the host's own bottom bar (a tab
 *  bar, a cookie strip). Only a bar that spans most of the width counts: a
 *  floating button is something the caption may cover for the length of a
 *  tour — the card wins on z-index — but a nav pinned under it would hide the
 *  caption's buttons. Substrata's phone tab bar did exactly that (2026-10-07).
 *  Pure, so it is testable without a browser. */
export function bottomBarInset(
  bars: { top: number; bottom: number; width: number }[],
  vw: number,
  vh: number,
): number {
  let inset = 0;
  for (const b of bars) {
    if (b.bottom < vh - 4 || b.width < vw * 0.6) continue;
    const h = vh - b.top;
    if (h > 0 && h <= vh * 0.3) inset = Math.max(inset, h);
  }
  return Math.round(inset);
}

/** Fixed or sticky host elements touching the bottom edge, read from what is
 *  actually painted there. Our own hosts are skipped. */
function measureBottomBars(): { top: number; bottom: number; width: number }[] {
  const vw = window.innerWidth;
  const y = window.innerHeight - 2;
  const out: { top: number; bottom: number; width: number }[] = [];
  const seen = new Set<Element>();
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const hit of document.elementsFromPoint(vw * fx, y)) {
      for (let el: Element | null = hit; el && el !== document.body; el = el.parentElement) {
        if (seen.has(el)) break;
        seen.add(el);
        if (el.closest("#loki-feedback-host, #loki-tour-host")) break;
        const pos = getComputedStyle(el).position;
        if (pos !== "fixed" && pos !== "sticky") continue;
        const r = el.getBoundingClientRect();
        out.push({ top: r.top, bottom: r.bottom, width: r.width });
      }
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tourCSS(t: WidgetTheme): string {
  const sans = t.fontSans ?? "system-ui, -apple-system, sans-serif";
  const mono = t.fontMono ?? "ui-monospace, SFMono-Regular, Menlo, monospace";
  const rs = t.radiusSurface ?? "8px";
  const rc = t.radiusControl ?? "6px";
  const ink = t.inkOnAccent ?? t.black;
  return `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; font-family: ${sans}; -webkit-font-smoothing: antialiased; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.ring { position: fixed; border: 2px solid ${t.accent}; border-radius: ${rc};
  box-shadow: 0 0 0 4px ${t.accentMuted}; opacity: 0;
  transition: all .7s cubic-bezier(.2,.8,.2,1), opacity .3s; }
.ring.on { opacity: 1; }
.ring.bad { border-color: ${t.error}; box-shadow: 0 0 0 4px ${t.errorSurface}; }
.cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; opacity: 0;
  transition: transform .9s cubic-bezier(.3,.7,.2,1), opacity .3s;
  filter: drop-shadow(0 1px 2px ${t.black}); }
.cursor.on { opacity: 1; }
.cursor svg { width: 26px; height: 26px; display: block; }
.ripple { position: fixed; width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid ${t.accent}; transform: translate(-50%,-50%) scale(.4); opacity: .9;
  animation: rip .6s ease-out forwards; }
@keyframes rip { to { transform: translate(-50%,-50%) scale(3.2); opacity: 0; } }
.card { position: fixed; left: 12px; right: 12px; bottom: calc(12px + var(--bar, 0px)); margin: 0 auto;
  max-width: 440px; z-index: 2147483647; transition: top .35s, bottom .35s;
  pointer-events: auto; background: ${t.surface}; color: ${t.text};
  border: 1px solid ${t.borderStrong}; border-radius: ${rs}; padding: 12px 14px;
  font-size: 14px; line-height: 1.45; }
.card.up { bottom: auto; top: 12px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.brand { display: flex; align-items: center; gap: 6px; color: ${t.textTertiary};
  font-family: ${mono}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: ${t.accent}; }
.count { font-family: ${mono}; font-size: 10px; color: ${t.textMuted}; }
.say { min-height: 2.9em; }
.say.bad { color: ${t.error}; }
.bar { height: 2px; background: ${t.border}; border-radius: 2px; margin-top: 10px; overflow: hidden; }
.fill { height: 100%; width: 0; background: ${t.accent}; transition: width .4s; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
button, a.btn { cursor: pointer; font: inherit; font-size: 12px; padding: 7px 12px; min-height: 36px;
  border-radius: ${rc}; border: 1px solid ${t.borderStrong}; background: transparent;
  color: ${t.textSecondary}; text-decoration: none; display: inline-flex; align-items: center; }
button.primary, a.btn.primary { background: ${t.accent}; border-color: ${t.accent}; color: ${ink}; }
button:focus-visible, a.btn:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .ring, .cursor, .fill { transition: none; }
  .ripple { animation: none; opacity: 0; }
}`;
}

const CURSOR_SVG = (t: WidgetTheme) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2l15 11.5-6.6.9 3.9 7.3-2.7 1.4-3.9-7.4L4 20.3z" fill="${t.white}" stroke="${t.black}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/** Report a step the tour could not show. Fire-and-forget: the owner already
 *  sees the honest sentence; Loki turns this into something to investigate. */
function reportProblem(apiBase: string, token: string, step: number, say: string, reason: string) {
  void fetch(`${apiBase}/api/widget/tour`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: token, problem: { step, say, reason, path: location.pathname } }),
    keepalive: true,
  }).catch(() => {});
}

export async function runTour(apiBase: string, token: string): Promise<void> {
  if (document.getElementById("loki-tour-host")) return;
  // Let the page settle (fonts, client components) before reading it.
  if (document.readyState !== "complete") {
    await new Promise<void>((r) => window.addEventListener("load", () => r(), { once: true }));
  }
  await sleep(600);
  const outline = buildTourOutline();
  let plan: TourPlan;
  try {
    const res = await fetch(`${apiBase}/api/widget/tour`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token, path: location.pathname, outline: outline.items }),
    });
    const body = (await res.json()) as TourPlan | { error?: string };
    if (!res.ok || !("ok" in body) || !body.theme) return;
    plan = body;
  } catch {
    return;
  }
  const t = plan.theme;

  const host = h("div");
  host.id = "loki-tour-host";
  const root = host.attachShadow({ mode: "open" });
  const style = h("style");
  style.textContent = tourCSS(t);
  const layer = h("div", "layer");
  const ring = h("div", "ring");
  const cursor = h("div", "cursor");
  cursor.innerHTML = CURSOR_SVG(t);
  const card = h("div", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("aria-label", "Loki walkthrough");
  const top = h("div", "top");
  const brand = h("div", "brand");
  brand.append(h("span", "dot"), h("span", undefined, `Loki · ${plan.title}`));
  const count = h("span", "count");
  top.append(brand, count);
  const say = h("p", "say");
  const bar = h("div", "bar");
  const fill = h("div", "fill");
  bar.appendChild(fill);
  const row = h("div", "row");
  card.append(top, say, bar, row);
  layer.append(ring, cursor);
  root.append(style, layer, card);
  let barInset = 0;
  const liftAboveBar = () => {
    barInset = bottomBarInset(measureBottomBars(), window.innerWidth, window.innerHeight);
    card.style.setProperty("--bar", `${barInset}px`);
  };
  document.body.appendChild(host);
  liftAboveBar();
  window.addEventListener("resize", liftAboveBar);
  // The launcher would sit on top of the caption; it comes back on close.
  const launcher = document.getElementById("loki-feedback-host");
  const launcherDisplay = launcher?.style.display ?? "";
  if (launcher) launcher.style.display = "none";

  let paused = false;
  let closed = false;
  let skip: (() => void) | null = null;
  const close = () => {
    closed = true;
    skip?.();
    window.removeEventListener("resize", liftAboveBar);
    host.remove();
    if (launcher) launcher.style.display = launcherDisplay;
  };
  const btn = (label: string, onClick: () => void, primary = false) => {
    const b = h("button", primary ? "primary" : undefined, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const pauseBtn = btn("Pause", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Play" : "Pause";
    if (!paused) skip?.();
  });
  const nextBtn = btn("Next", () => skip?.());
  row.append(pauseBtn, nextBtn, btn("Close", close));

  /** Hold a beat — cut short by Next, extended while paused. */
  const hold = (ms: number) =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        skip = null;
        resolve();
      };
      skip = finish;
      const tick = (left: number) => {
        if (done) return;
        if (paused) return void setTimeout(() => tick(left), 200);
        if (left <= 0) return finish();
        setTimeout(() => tick(left - 200), 200);
      };
      tick(ms);
    });

  const cx = { x: window.innerWidth / 2, y: window.innerHeight * 0.35 };
  const moveCursor = (x: number, y: number) => {
    cx.x = x;
    cx.y = y;
    cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const frame = (el: Element) => {
    const r = el.getBoundingClientRect();
    const pad = 6;
    ring.style.left = `${r.left - pad}px`;
    ring.style.top = `${r.top - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;
    ring.classList.add("on");
    // The caption never covers what it is talking about: an element low on
    // the screen (a footer link can never be scrolled to the middle) sends
    // the card to the top.
    card.classList.toggle("up", r.bottom > window.innerHeight - barInset - card.offsetHeight - 24);
    return r;
  };
  const tap = (x: number, y: number) => {
    const rip = h("div", "ripple");
    rip.style.left = `${x}px`;
    rip.style.top = `${y}px`;
    layer.appendChild(rip);
    setTimeout(() => rip.remove(), 700);
  };
  const beat = (text: string, n: number, total: number, bad = false) => {
    say.textContent = text;
    say.classList.toggle("bad", bad);
    count.textContent = total ? `${Math.min(n, total)} / ${total}` : "";
    fill.style.width = total ? `${Math.round((Math.min(n, total) / total) * 100)}%` : "0";
  };

  const find = (step: TourStep): Element | null => {
    if (step.target !== null && outline.els[step.target]?.isConnected)
      return outline.els[step.target];
    if (step.selector) {
      try {
        return document.querySelector(step.selector);
      } catch {
        return null;
      }
    }
    return null;
  };

  moveCursor(cx.x, cx.y);
  cursor.classList.add("on");
  const total = plan.steps.length;
  beat(plan.intro, 0, total);
  await hold(2600);

  let problem = false;
  for (let n = 0; n < total && !closed; n++) {
    const step = plan.steps[n];
    if (step.target === null && !step.selector) {
      ring.classList.remove("on");
      if (step.action === "scroll") window.scrollTo({ top: 0, behavior: "smooth" });
      beat(step.say, n + 1, total);
      await hold(3000);
      continue;
    }
    const el = find(step);
    if (!el || !shown(el)) {
      problem = true;
      ring.classList.remove("on");
      card.classList.remove("up");
      moveCursor(window.innerWidth / 2, window.innerHeight * 0.3);
      beat(
        `Oops — I wanted to show you this, but it isn't on the page: “${step.say}”. That's on us, not you — I've flagged it and it will be investigated.`,
        n + 1,
        total,
        true,
      );
      reportProblem(
        apiBase,
        token,
        n,
        step.say,
        el ? "element is hidden or has no size" : "element not found",
      );
      await hold(6000);
      continue;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(750);
    if (closed) break;
    const r = frame(el);
    moveCursor(r.left + Math.min(r.width / 2, 40), r.top + Math.min(r.height / 2, 20));
    beat(step.say, n + 1, total);
    await sleep(950);
    if (step.action === "click" && !closed) {
      tap(cx.x, cx.y);
      if (safeToClick(el)) {
        await sleep(250);
        (el as HTMLElement).click();
        // A click usually moves the page (an anchor scrolls): follow the
        // element if it is still in view, otherwise let the page speak.
        await sleep(900);
        const after = el.getBoundingClientRect();
        if (after.bottom < 0 || after.top > window.innerHeight) {
          ring.classList.remove("on");
          card.classList.remove("up");
          moveCursor(window.innerWidth / 2, window.innerHeight * 0.3);
        } else {
          const r2 = frame(el);
          moveCursor(r2.left + Math.min(r2.width / 2, 40), r2.top + Math.min(r2.height / 2, 20));
        }
      }
    }
    await hold(3400);
  }
  if (closed) return;

  ring.classList.remove("on");
  cursor.classList.remove("on");
  card.classList.remove("up");
  beat(
    problem
      ? "Part of this did not show up the way it should. It has been flagged — nothing more for you to do here."
      : plan.outro,
    total,
    total,
    problem,
  );
  row.replaceChildren();
  if (plan.lokiHref) {
    const back = h("a", "btn primary", problem ? "Back to Loki" : "Looks right — confirm in Loki");
    back.href = plan.lokiHref;
    row.appendChild(back);
  }
  if (plan.prUrl) {
    const pr = h("a", "btn", "What changed");
    pr.href = plan.prUrl;
    pr.target = "_blank";
    pr.rel = "noreferrer";
    row.appendChild(pr);
  }
  row.append(
    btn("Replay", () => {
      // The token is still valid; the page is read again from the top.
      window.removeEventListener("resize", liftAboveBar);
      host.remove();
      if (launcher) launcher.style.display = launcherDisplay;
      window.scrollTo({ top: 0, behavior: "smooth" });
      void runTour(apiBase, token);
    }),
    btn("Close", close),
  );
}

/** Start a walkthrough if this page load carried a tour token. */
export function startTourFromFragment(apiBase: string): void {
  const token = takeTourToken();
  if (token) void runTour(apiBase, token);
}
