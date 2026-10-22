/**
 * Walk Loki's pages the way a person on a phone does, and write down what is
 * visibly wrong — design-reset-2026-10.md, "How a page is checked".
 *
 *   node scripts/audit-pages.mjs <outDir>
 *     BASE=http://localhost:3000            (default: production)
 *     ROUTES=/control,/projects             (default: every app page)
 *     AUDIT_EMAIL / AUDIT_PASSWORD          (default: the public demo)
 *     THEME=light|dark                      (default: light — the owner's)
 *
 * The demo has three tidy projects, so long lists, failures and stale alerts
 * never show on it. To see the pages the way the owner does, seed the local
 * showcase account (`pnpm run seed:showcase`, local databases only) and pass
 * its pair:
 *
 *   AUDIT_EMAIL=owner@loki.local AUDIT_PASSWORD=showcase-owner \
 *     BASE=http://localhost:3000 node scripts/audit-pages.mjs .tmp/audit
 *
 * Writes phone-<page>.png (first screen), phone-<page>-full.png, desk-<page>.png
 * and report.json: overflow, <h1> count, sticky/fixed blocks, text cut off,
 * small tap targets, console errors and failed requests per page.
 */
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.BASE ?? "https://loki.orangecat.ch";
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const ROUTES = (
  process.env.ROUTES ??
  "/control,/projects,/loki,/terminal,/prompts,/voice,/today,/suggestions,/approvals,/feedback,/my-feedback,/packages,/fleet,/system,/activity,/people,/crew,/money,/goals,/habits,/events,/memory,/thoughts,/settings,/robots,/download,/roadmap,/why,/whitepaper,/investors"
).split(",");
const exe =
  process.env.CHROMIUM_PATH ??
  (fs.existsSync("/opt/pw-browsers/chromium-1248/chrome-linux64/chrome")
    ? "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome"
    : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const THEME = process.env.THEME ?? "light";

async function login(ctx) {
  const r = await ctx.request.get(BASE + "/api/auth/csrf");
  const { csrfToken } = await r.json();
  const res = await ctx.request.post(BASE + "/api/auth/callback/email-password", {
    form: {
      csrfToken,
      email: process.env.AUDIT_EMAIL ?? "demo@loki.app",
      password: process.env.AUDIT_PASSWORD ?? "explore-the-fleet",
      callbackUrl: BASE + "/control",
      json: "true",
    },
    maxRedirects: 0,
  });
  const cookies = await ctx.cookies();
  if (!cookies.some((c) => /session-token/.test(c.name)))
    throw new Error("login failed " + res.status());
}

async function measure(page) {
  return page.evaluate(() => {
    const vw = innerWidth,
      vh = innerHeight;
    const out = {
      overflowX: document.documentElement.scrollWidth > vw + 1,
      h1: document.querySelectorAll("h1").length,
      h1Text: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim().slice(0, 60)),
    };
    let truncated = [],
      small = [],
      fixedArea = 0,
      fixed = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (
        (cs.position === "fixed" || cs.position === "sticky") &&
        r.top < vh &&
        r.bottom > 0 &&
        r.width > vw * 0.5
      ) {
        fixed.push({
          tag: el.tagName,
          cls: el.className?.toString().slice(0, 60),
          h: Math.round(r.height),
          top: Math.round(r.top),
        });
      }
      if (
        el.children.length === 0 &&
        el.textContent.trim() &&
        el.scrollWidth > el.clientWidth + 1 &&
        (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none")
      )
        truncated.push(el.textContent.trim().slice(0, 70));
      if (
        (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button") &&
        r.top < vh * 3 &&
        (r.height < 32 || r.width < 32) &&
        el.textContent.trim().length < 30
      )
        small.push(
          (el.textContent.trim() || el.getAttribute("aria-label") || el.tagName).slice(0, 30) +
            ` ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
    }
    out.fixed = fixed;
    out.truncated = [...new Set(truncated)].slice(0, 25);
    out.smallTargets = [...new Set(small)].slice(0, 20);
    out.textLen = document.body.innerText.length;
    return out;
  });
}

const report = {};
for (const [label, vp] of [
  ["phone", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ["desk", { width: 1440, height: 900 }],
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile ?? false,
    hasTouch: vp.hasTouch ?? false,
    deviceScaleFactor: vp.deviceScaleFactor ?? 1,
  });
  await login(ctx);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("loki-theme", t);
    } catch {}
  }, THEME);
  const extra = [];
  for (let i = 0; i < ROUTES.length + extra.length; i++) {
    const route = i < ROUTES.length ? ROUTES[i] : extra[i - ROUTES.length];
    // A page of its own per route: a tall page can crash Chromium's renderer,
    // and a crashed page must not take every route after it down too.
    const page = await ctx.newPage();
    try {
      const errs = [],
        bad = [];
      page.removeAllListeners("console");
      page.removeAllListeners("response");
      page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
      page.on(
        "response",
        (r) =>
          r.status() >= 400 &&
          bad.push(
            `${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 100)}`,
          ),
      );
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 });
      } catch (e) {
        errs.push("goto: " + e.message.slice(0, 120));
      }
      await page.waitForTimeout(2500);
      const name = route.replace(/\W+/g, "_").replace(/^_/, "") || "root";
      await page
        .screenshot({ path: `${OUT}/${label}-${name}.png` })
        .catch((e) => errs.push("screenshot: " + e.message.slice(0, 80)));
      if (label === "phone")
        await page
          .screenshot({ path: `${OUT}/${label}-${name}-full.png`, fullPage: true })
          .catch(() => undefined);
      // A dev server recompiles and reloads a page it just served; measure
      // once it has settled rather than losing the whole report to one reload.
      let m;
      for (let attempt = 0; attempt < 3 && !m; attempt++) {
        m = await measure(page).catch(async () => {
          await page.waitForLoadState("networkidle").catch(() => undefined);
          await page.waitForTimeout(1500);
          return undefined;
        });
      }
      m ??= { error: "page kept reloading" };
      report[`${label} ${route}`] = {
        finalUrl: page.url().replace(BASE, ""),
        consoleErrors: [...new Set(errs)].slice(0, 8),
        failedRequests: [...new Set(bad)].slice(0, 12),
        ...m,
      };
      if (label === "phone" && route === "/projects" && !process.env.ROUTES) {
        const href = await page
          .locator('a[href^="/projects/"]')
          .first()
          .getAttribute("href")
          .catch(() => null);
        if (href) {
          extra.push(href, href + "/watch");
        }
      }
      if (label === "phone" && route === "/feedback" && !process.env.ROUTES) {
        const href = await page
          .locator('a[href^="/feedback/"]')
          .first()
          .getAttribute("href")
          .catch(() => null);
        if (href) extra.push(href);
      }
    } catch (e) {
      report[`${label} ${route}`] = { error: String(e.message ?? e).slice(0, 160) };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  if (label === "phone") ROUTES.push(...extra.filter((r) => !ROUTES.includes(r)));
  await ctx.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log("done", Object.keys(report).length);
