/**
 * A picture of a live page, the way a visitor on a phone sees it.
 *
 * Text settles most fixes (verify-live-rules.ts); it cannot settle a
 * layout, a colour, a thing that overlaps — and those were exactly the fixes
 * the owner was still being sent to look at. So when text cannot tell, Loki
 * takes one picture and asks a vision model the same question.
 *
 * The browser is Playwright's Chromium — a devDependency the standalone
 * build carries because this file imports it (next.config.ts lists it as a
 * server external so it is not bundled). The browser binary itself is
 * whatever the server has: Playwright's own cache, or CHROME_PATH, or a
 * system Chromium. None of them → no picture, and the verdict says so in
 * words on the card, so a missing browser is one install away, never a
 * silent "cannot tell".
 *
 * One browser at a time: a few hundred megabytes for a few seconds is fine;
 * several at once on the app box is not.
 */
import { existsSync } from "node:fs";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { isPrivateAddress } from "@/lib/private-address";
import { isRuntimeAvailable } from "@/lib/runtime";

/**
 * Does this host resolve only to public addresses?
 *
 * The page's address is the project's live URL, which the account typed
 * itself — and the browser runs on the SERVER. Pointed at 127.0.0.1 or a
 * private network name, it photographed services the server can reach and
 * nobody else should see (found 2026-10-17). Same rule as Loki's own page
 * reader (lib/site-consult/fetch-page.ts), checked on every request the page
 * makes, so a redirect or an embedded frame cannot take the browser inside.
 */
async function publicHost(host: string, seen: Map<string, boolean>): Promise<boolean> {
  const known = seen.get(host);
  if (known !== undefined) return known;
  let ok = false;
  try {
    const dns = await import("node:dns/promises");
    const answers = await dns.lookup(host.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
    ok = answers.length > 0 && !answers.some((a) => isPrivateAddress(a.address));
  } catch {
    ok = false;
  }
  seen.set(host, ok);
  return ok;
}

/** The phone the deploy's page check uses (scripts/hetzner/page-check.mjs). */
export const PICTURE_VIEWPORT = { width: 390, height: 844 } as const;
const JPEG_QUALITY = 55;
const SETTLE_MS = 800;
/** How long a page may keep loading images, then keep talking, before it is photographed anyway. */
const IDLE_WAIT_MS = 8_000;
const SYSTEM_BROWSERS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

export type PagePicture =
  | { ok: true; mimeType: "image/jpeg"; base64: string }
  | {
      ok: false;
      reason: PictureFailure;
      /** For did-not-load: the HTTP status, or the error's first words (a
       *  timeout, a refused connection) — what tells a site that blocks the
       *  browser from a network path that is slow. */
      detail?: string;
    };

/** An error's first line, short enough for a header. */
const firstLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 80);

/** Why there is no picture: Playwright itself is missing from this build, no
 *  browser is installed for it, or the page did not load. */
export type PictureFailure = "no-playwright" | "no-browser" | "did-not-load";

/**
 * Can this server take pictures at all? Answered without launching anything
 * and shown on /api/health, so "no browser" is a fact an operator reads off
 * the health line instead of discovering it on a card weeks later (the box
 * had none from the day the feature shipped until 2026-10-17, and every
 * picture quietly fell back to a link).
 */
export type BrowserStatus = {
  /** Playwright itself is in this build (it is a devDependency the standalone must trace). */
  playwright: boolean;
  /** The Chromium Playwright would launch, or null when none is installed for it. */
  browser: string | null;
  ok: boolean;
};

let statusAt = 0;
let status: BrowserStatus | null = null;
const STATUS_TTL_MS = 60_000;

export async function browserStatus(): Promise<BrowserStatus> {
  if (status && Date.now() - statusAt < STATUS_TTL_MS) return status;
  let playwright = false;
  let browser: string | null = null;
  try {
    const pw = await import("playwright");
    playwright = true;
    browser = await browserPath(pw.chromium);
  } catch {
    playwright = false;
  }
  status = { playwright, browser, ok: playwright && Boolean(browser) };
  statusAt = Date.now();
  return status;
}

let queue: Promise<unknown> = Promise.resolve();

/** Where a browser is, or null. CHROME_PATH wins; then Playwright's own. */
async function browserPath(chromium: { executablePath(): string }): Promise<string | null> {
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const own = chromium.executablePath();
    if (own && existsSync(own)) return own;
  } catch {
    // no managed browser — fall through to the system ones
  }
  return SYSTEM_BROWSERS.find((p) => existsSync(p)) ?? null;
}

/**
 * Open the page at phone size, scroll the pointed-at element into view when
 * the report named one, and return a JPEG of the viewport.
 */
export type PictureOptions = {
  /** Where the page was scrolled to, when the report recorded it and no
   *  element was pointed at — the same view the person had. */
  scrollY?: number | null;
  /** A cookie the page needs to open — a preview's own access cookie, so Loki
   *  can photograph a page it keeps behind its code. */
  cookies?: { name: string; value: string; url: string }[];
  /** Headers on every request the page makes (a preview served for a picture
   *  is told so, and leaves its widget out). */
  headers?: Record<string, string>;
};

export function takePagePicture(
  url: string,
  selector?: string | null,
  opts: PictureOptions = {},
): Promise<PagePicture> {
  const next = queue.then(() => takeOne(url, selector, opts));
  queue = next.catch(() => undefined);
  return next;
}

async function takeOne(
  url: string,
  selector?: string | null,
  opts: PictureOptions = {},
): Promise<PagePicture> {
  const scrollY = opts.scrollY ?? null;
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { ok: false, reason: "no-playwright" };
  }
  const executablePath = await browserPath(chromium);
  if (!executablePath) return { ok: false, reason: "no-browser" };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({
      viewport: { ...PICTURE_VIEWPORT },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Loki fix check",
      extraHTTPHeaders: opts.headers,
    });
    if (opts.cookies?.length) await page.context().addCookies(opts.cookies);
    // On a person's own machine (the desktop app) the private network is
    // theirs — their dev server on localhost is the page to look at.
    const seen = new Map<string, boolean>();
    if (!isRuntimeAvailable())
      await page.route("**/*", async (route) => {
        let host: string;
        try {
          const u = new URL(route.request().url());
          if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
          host = u.hostname;
        } catch {
          return route.abort();
        }
        return (await publicHost(host, seen)) ? route.continue() : route.abort();
      });
    // The document is enough to photograph. "load" (every image) and "network
    // idle" are each waited for only as long as IDLE_WAIT_MS allows: a shop
    // homepage with hundreds of product images, or analytics beacons that
    // never go quiet, used to time out the whole goto and leave no picture at
    // all (center-com.ru, 2026-10-17: did-not-load at 30 s on "load").
    let failure = "";
    const res = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: HTTP_TIMEOUT_LONG_MS })
      .catch((e: unknown) => {
        failure = firstLine(e);
        return null;
      });
    if (!res) return { ok: false, reason: "did-not-load", detail: failure || "no response" };
    if (!res.ok()) return { ok: false, reason: "did-not-load", detail: `HTTP ${res.status()}` };
    await page.waitForLoadState("load", { timeout: IDLE_WAIT_MS }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: IDLE_WAIT_MS }).catch(() => undefined);
    await page.waitForTimeout(SETTLE_MS);
    if (selector) {
      await page
        .locator(selector)
        .first()
        .scrollIntoViewIfNeeded({ timeout: 2_000 })
        .catch(() => undefined);
      await page.waitForTimeout(300);
    } else if (scrollY && scrollY > 0) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY).catch(() => undefined);
      await page.waitForTimeout(300);
    }
    const bytes = await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY });
    return { ok: true, mimeType: "image/jpeg", base64: Buffer.from(bytes).toString("base64") };
  } catch (e) {
    return { ok: false, reason: "did-not-load", detail: firstLine(e) };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
