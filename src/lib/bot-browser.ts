/**
 * A browser of its own for every bot: it opens a page, clicks, types, and is
 * handed back what the page now shows — a picture, and the same page in
 * words with its buttons, links and fields numbered, so a model that cannot
 * see pictures can still drive it.
 *
 * Cat Bot's computer use (OrangeCat docs/PARITY.md, plan step 2), on the base
 * the site walk laid: Loki's own Chromium on the box, never OrangeCat's web
 * process, every request checked against the private network
 * (lib/feedback/page-picture).
 *
 * One session per (account, bot): its own context, its own cookies. The
 * cookies are kept between sessions in a file only this server reads, so a
 * site the owner signed the bot into stays signed in; nothing is shared with
 * another bot or with the owner's own browser. A session closes after three
 * idle minutes, twenty minutes at the outside, and the box holds two at once.
 *
 * The bounds are lib/bot-browser-rules: a bot never types a password or a
 * card. This file only drives.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { privateNetworkGuard, serverChromium } from "@/lib/feedback/page-picture";
import { isRuntimeAvailable } from "@/lib/runtime";
import {
  BOT_BROWSER_ELEMENTS_MAX,
  BOT_BROWSER_MAX_SESSIONS,
  BOT_BROWSER_TEXT_MAX,
  BOT_BROWSER_VIEWPORT,
  openableUrl,
  refusalForField,
  sessionToEvict,
  sessionsToClose,
  type BotBrowserAction,
  type FieldFacts,
} from "@/lib/bot-browser-rules";

type Browser = import("playwright").Browser;
type Context = import("playwright").BrowserContext;
type Page = import("playwright").Page;

type Session = {
  key: string;
  browser: Browser;
  context: Context;
  page: Page;
  stateFile: string;
  openedAt: number;
  lastUsedAt: number;
  /** One action at a time per session. */
  queue: Promise<unknown>;
};

export type PageElement = { n: number; kind: string; name: string };

export type BotBrowserView = {
  url: string;
  title: string;
  /** What a visitor can read, from the top of what is on screen. */
  text: string;
  /** What can be clicked or typed into, numbered; `n` is what click and type take. */
  elements: PageElement[];
  /** JPEG of the viewport, base64. */
  screenshot?: string;
};

export type BotBrowserResult =
  | { ok: true; closed?: boolean; view?: BotBrowserView; note?: string }
  | {
      ok: false;
      /** stopped: a bound (password, card). busy: the box is full. failed: the page or the step. */
      reason: "stopped" | "busy" | "failed" | "no-browser";
      detail: string;
      view?: BotBrowserView;
    };

const store = globalThis as unknown as { __lokiBotBrowsers?: Map<string, Session> };
const sessions = (store.__lokiBotBrowsers ??= new Map<string, Session>());

const ACTION_TIMEOUT_MS = 12_000;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 600;
const JPEG_QUALITY = 50;
const AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Loki bot browser";

const firstLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 120);

function stateDir(): string {
  const dir =
    process.env.LOKI_BOT_BROWSER_DIR?.trim() || path.join(os.tmpdir(), "loki-bot-browser");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function botBrowserKey(userId: string, botId: string): string {
  return createHash("sha256").update(`${userId}\n${botId}`).digest("hex").slice(0, 32);
}

async function closeSession(s: Session): Promise<void> {
  sessions.delete(s.key);
  await s.context.storageState({ path: s.stateFile }).catch(() => undefined);
  await chmod(s.stateFile, 0o600).catch(() => undefined);
  await s.browser.close().catch(() => undefined);
}

async function sweep(now: number): Promise<void> {
  const ages = [...sessions.values()].map(({ key, lastUsedAt, openedAt }) => ({
    key,
    lastUsedAt,
    openedAt,
  }));
  for (const key of sessionsToClose(ages, now)) {
    const s = sessions.get(key);
    if (s) await closeSession(s);
  }
}

let sweeper: ReturnType<typeof setInterval> | null = null;
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    void sweep(Date.now()).then(() => {
      if (sessions.size === 0 && sweeper) {
        clearInterval(sweeper);
        sweeper = null;
      }
    });
  }, 30_000);
  sweeper.unref?.();
}

async function openSession(
  key: string,
): Promise<{ ok: true; session: Session } | Extract<BotBrowserResult, { ok: false }>> {
  const now = Date.now();
  await sweep(now);
  if (sessions.size >= BOT_BROWSER_MAX_SESSIONS) {
    const ages = [...sessions.values()].map(({ key: k, lastUsedAt, openedAt }) => ({
      key: k,
      lastUsedAt,
      openedAt,
    }));
    const evict = sessionToEvict(ages, now);
    const victim = evict ? sessions.get(evict) : null;
    if (!victim) {
      return {
        ok: false,
        reason: "busy",
        detail: "Every bot browser on this Loki is in use right now. Try again in a minute.",
      };
    }
    await closeSession(victim);
  }
  const found = await serverChromium();
  if (!found.ok) {
    return {
      ok: false,
      reason: "no-browser",
      detail: "No browser is installed on this Loki, so a bot cannot open pages here.",
    };
  }
  const stateFile = path.join(stateDir(), `${key}.json`);
  const browser = await found.chromium.launch({
    headless: true,
    executablePath: found.executablePath,
  });
  try {
    const context = await browser.newContext({
      viewport: { ...BOT_BROWSER_VIEWPORT },
      deviceScaleFactor: 1,
      userAgent: AGENT,
      ...(existsSync(stateFile) ? { storageState: stateFile } : {}),
    });
    // The whole context, so a page opened by a click is guarded too. On a
    // person's own machine (the desktop app) the private network is theirs.
    if (!isRuntimeAvailable()) await context.route("**/*", privateNetworkGuard());
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    const page = await context.newPage();
    // A link that opens a new tab: the bot follows it, and the old tab goes.
    context.on("page", (next) => {
      const s = sessions.get(key);
      if (!s || next === s.page) return;
      const old = s.page;
      s.page = next;
      void old.close().catch(() => undefined);
    });
    const session: Session = {
      key,
      browser,
      context,
      page,
      stateFile,
      openedAt: now,
      lastUsedAt: now,
      queue: Promise.resolve(),
    };
    sessions.set(key, session);
    ensureSweeper();
    return { ok: true, session };
  } catch (e) {
    await browser.close().catch(() => undefined);
    return { ok: false, reason: "failed", detail: `The browser did not start (${firstLine(e)}).` };
  }
}

/** Runs in the page: number what can be acted on, read what can be read. */
const PAGE_READER = String.raw`function (maxElements, maxText) {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  }
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }
  document.querySelectorAll("[data-loki-n]").forEach(function (el) {
    el.removeAttribute("data-loki-n");
  });
  var found = Array.prototype.slice
    .call(
      document.querySelectorAll(
        'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"], summary'
      )
    )
    .filter(visible);
  // What is on screen first, then the rest of the page, in reading order.
  var ordered = found
    .filter(inView)
    .concat(found.filter(function (el) { return !inView(el); }))
    .slice(0, maxElements);
  var elements = ordered.map(function (el, i) {
    var n = i + 1;
    el.setAttribute("data-loki-n", String(n));
    var tag = el.tagName.toLowerCase();
    var kind =
      tag === "a" ? "link"
      : tag === "input" ? "field:" + (el.type || "text")
      : tag === "textarea" ? "field:text"
      : tag === "select" ? "choice"
      : el.getAttribute("role") || "button";
    var label =
      el.getAttribute("aria-label") ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.placeholder ||
      el.innerText ||
      el.value ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      "";
    return { n: n, kind: kind, name: String(label).replace(/\s+/g, " ").trim().slice(0, 80) };
  });
  return {
    title: document.title,
    text: ((document.body && document.body.innerText) || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText),
    elements: elements,
  };
}`;

/** Runs in the page: what kind of field is element n, or the focused one. */
const FIELD_READER = String.raw`function (num) {
  var el = num ? document.querySelector('[data-loki-n="' + num + '"]') : document.activeElement;
  if (!el || el === document.body) return null;
  return {
    type: el.getAttribute("type") || el.tagName.toLowerCase(),
    autocomplete: el.getAttribute("autocomplete") || "",
    name: (el.getAttribute("name") || "") + " " + (el.id || ""),
  };
}`;

/** Number what can be acted on, and read the page as a visitor would. */
async function look(page: Page, withPicture: boolean): Promise<BotBrowserView> {
  await page
    .waitForLoadState("domcontentloaded", { timeout: ACTION_TIMEOUT_MS })
    .catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
  // The reader is a string on purpose: a bundler that names inner functions
  // (esbuild's __name helper) breaks a function sent into the page, and the
  // page then reads as empty with no error anyone sees.
  const read = await page
    .evaluate<{ title: string; text: string; elements: PageElement[] }>(
      `(${PAGE_READER})(${BOT_BROWSER_ELEMENTS_MAX}, ${BOT_BROWSER_TEXT_MAX})`,
    )
    .catch(() => ({ title: "", text: "", elements: [] as PageElement[] }));
  let screenshot: string | undefined;
  if (withPicture) {
    const bytes = await page
      .screenshot({
        type: "jpeg",
        quality: JPEG_QUALITY,
        animations: "disabled",
        timeout: ACTION_TIMEOUT_MS,
      })
      .catch(() => null);
    if (bytes) screenshot = Buffer.from(bytes).toString("base64");
  }
  return { url: page.url(), ...read, ...(screenshot ? { screenshot } : {}) };
}

/** What kind of field is this, before anything is typed into it. */
async function fieldFacts(page: Page, n: number | undefined): Promise<FieldFacts | null> {
  return page.evaluate<FieldFacts | null>(`(${FIELD_READER})(${n ?? 0})`).catch(() => null);
}

async function perform(
  s: Session,
  action: BotBrowserAction,
  withPicture: boolean,
): Promise<BotBrowserResult> {
  const page = s.page;
  try {
    switch (action.do) {
      case "open": {
        const target = openableUrl(action.url);
        if (!target.ok) return { ok: false, reason: "failed", detail: target.why };
        const res = await page.goto(target.url, { waitUntil: "domcontentloaded" });
        if (res && !res.ok()) {
          return {
            ok: false,
            reason: "failed",
            detail: `The page answered HTTP ${res.status()}.`,
            view: await look(page, withPicture),
          };
        }
        break;
      }
      case "click": {
        if (action.n) {
          await page.locator(`[data-loki-n="${action.n}"]`).first().click();
        } else if (action.label) {
          const byRole = page
            .getByRole("button", { name: action.label })
            .or(page.getByRole("link", { name: action.label }))
            .first();
          if (await byRole.count()) await byRole.click();
          else await page.getByText(action.label, { exact: false }).first().click();
        } else {
          return {
            ok: false,
            reason: "failed",
            detail: "A click names an element by its number (n) or its words (label).",
          };
        }
        break;
      }
      case "type": {
        const refusal = refusalForField(await fieldFacts(page, action.n));
        if (refusal) {
          return {
            ok: false,
            reason: "stopped",
            detail: refusal,
            view: await look(page, withPicture),
          };
        }
        if (action.n) await page.locator(`[data-loki-n="${action.n}"]`).first().fill(action.text);
        else await page.keyboard.type(action.text);
        if (action.submit) await page.keyboard.press("Enter");
        break;
      }
      case "press":
        await page.keyboard.press(action.key);
        break;
      case "scroll":
        await page.mouse.wheel(0, action.by === "down" ? 640 : -640);
        break;
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded" });
        break;
      case "look":
        break;
      case "close":
        await closeSession(s);
        return { ok: true, closed: true };
    }
    // A click may have opened a new tab; the session follows it.
    return { ok: true, view: await look(s.page, withPicture) };
  } catch (e) {
    const view = await look(s.page, withPicture).catch(() => undefined);
    return {
      ok: false,
      reason: "failed",
      detail: `That step did not work (${firstLine(e)}).`,
      ...(view ? { view } : {}),
    };
  }
}

/**
 * One step in a bot's browser. Opens the bot's session when it has none
 * (only `open` starts one: a click with no page open is said, not guessed).
 * Never throws.
 */
export async function botBrowserStep(
  userId: string,
  botId: string,
  action: BotBrowserAction,
  opts: { screenshot?: boolean } = {},
): Promise<BotBrowserResult> {
  const key = botBrowserKey(userId, botId);
  let session = sessions.get(key) ?? null;
  if (!session) {
    if (action.do === "close") return { ok: true, closed: true };
    if (action.do !== "open") {
      return {
        ok: false,
        reason: "failed",
        detail:
          "This bot has no page open (a browser closes after three idle minutes). Open an address first.",
      };
    }
    const opened = await openSession(key);
    if (!opened.ok) return opened;
    session = opened.session;
  }
  const s = session;
  s.lastUsedAt = Date.now();
  const run = s.queue.then(() => perform(s, action, opts.screenshot !== false));
  s.queue = run.catch(() => undefined);
  const result = await run.catch((e: unknown): BotBrowserResult => ({
    ok: false,
    reason: "failed",
    detail: firstLine(e),
  }));
  s.lastUsedAt = Date.now();
  if (sessions.has(key)) {
    await s.context.storageState({ path: s.stateFile }).catch(() => undefined);
    await chmod(s.stateFile, 0o600).catch(() => undefined);
  }
  return result;
}
