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

/** The phone the deploy's page check uses (scripts/hetzner/page-check.mjs). */
export const PICTURE_VIEWPORT = { width: 390, height: 844 } as const;
const JPEG_QUALITY = 55;
const SETTLE_MS = 800;
const SYSTEM_BROWSERS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

export type PagePicture =
  | { ok: true; mimeType: "image/jpeg"; base64: string }
  | { ok: false; reason: "no-browser" | "did-not-load" };

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
export function takePagePicture(
  url: string,
  selector?: string | null,
  /** Where the page was scrolled to, when the report recorded it and no
   *  element was pointed at — the same view the person had. */
  opts: { scrollY?: number | null } = {},
): Promise<PagePicture> {
  const next = queue.then(() => takeOne(url, selector, opts.scrollY ?? null));
  queue = next.catch(() => undefined);
  return next;
}

async function takeOne(
  url: string,
  selector?: string | null,
  scrollY: number | null = null,
): Promise<PagePicture> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { ok: false, reason: "no-browser" };
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
    });
    const res = await page
      .goto(url, { waitUntil: "networkidle", timeout: HTTP_TIMEOUT_LONG_MS })
      .catch(() => null);
    if (!res || !res.ok()) return { ok: false, reason: "did-not-load" };
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
  } catch {
    return { ok: false, reason: "did-not-load" };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
