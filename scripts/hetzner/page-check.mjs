// Look at a live page the way a visitor on a phone does, and write down what
// was there. The deploy workflow runs it before and after shipping, and
// page-check-compare.mjs decides whether the change made the page worse.
//
// Usage: node page-check.mjs <url> <out.json> [screenshot.png]
// CHROME_PATH points at an installed Chrome (GitHub's runners ship one), so no
// browser is downloaded. Always writes <out.json>; a page that could not be
// opened is recorded as { ok: false }, never as a crash.
import fs from "node:fs";
import { chromium } from "playwright";

const [url, out, shot] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node page-check.mjs <url> <out.json> [screenshot.png]");
  process.exit(1);
}

const result = {
  url,
  ok: false,
  status: null,
  overflowX: false,
  errors: 0,
  brokenImages: 0,
  textLength: 0,
  headings: 0,
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  let errors = 0;
  page.on("pageerror", () => errors++);
  page.on("console", (m) => {
    if (m.type() === "error") errors++;
  });
  const response = await page
    .goto(url, { waitUntil: "networkidle", timeout: 45_000 })
    .catch(() => null);
  result.status = response?.status() ?? null;
  // Let late scripts and images settle; errors they raise belong to the page.
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    brokenImages: [...document.images].filter(
      (img) => img.getAttribute("src") && img.complete && img.naturalWidth === 0,
    ).length,
    textLength: (document.body?.innerText ?? "").trim().length,
    headings: document.querySelectorAll("h1, h2, h3").length,
  }));
  Object.assign(result, seen, { errors, ok: result.status !== null && result.status < 400 });
  if (shot) await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
} catch (err) {
  console.error(
    `page-check: could not look at ${url}: ${err instanceof Error ? err.message : err}`,
  );
} finally {
  await browser?.close().catch(() => undefined);
}

fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(
  `page-check ${url}: ${result.ok ? `HTTP ${result.status}` : "did not load"}, ` +
    `sideways scroll ${result.overflowX ? "yes" : "no"}, ${result.errors} error(s), ` +
    `${result.brokenImages} broken image(s), ${result.textLength} chars, ${result.headings} heading(s)`,
);
