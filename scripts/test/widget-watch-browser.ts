// Watch mode in a real browser: the owner sees "Loki is watching" the whole
// time; a request the site makes that fails with a 500 files ONE report with
// the trail (the tap that led there included, the typed value excluded);
// Pause stops it, and paused, a failure files nothing. A visitor without the
// owner pass gets no pill and no recording at all.
// Run: npx tsx scripts/test/widget-watch-browser.ts
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PALETTE } from "../../src/lib/palette";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const ORIGIN = "http://host.fixture";
const SITE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main><h1>Shop</h1><input id="email" placeholder="Your email">
<button id="buy">Buy now</button><button id="dead">Save</button><button id="ok">Refresh</button></main>
<script>document.getElementById("buy").onclick = () => fetch("/shop/checkout?token=secret", { method: "POST" });
document.getElementById("ok").onclick = () => fetch("/shop/ok");</script>
<script src="${ORIGIN}/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`;

type Report = { suggestion: string; ownerPass?: string };

async function open(browser: Browser, js: string, hash: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  const reports: Report[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, body: JSON.stringify(body), contentType: "application/json" });
    if (url.pathname === "/widget.js")
      return route.fulfill({ body: js, contentType: "text/javascript" });
    if (url.pathname === "/api/widget-boot") {
      return json({
        active: true,
        placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
        theme: PALETTE.widget,
      });
    }
    if (url.pathname === "/api/feedback") {
      reports.push(JSON.parse(route.request().postData() ?? "{}") as Report);
      return json({ ok: true, owner: true, building: true });
    }
    if (url.pathname === "/shop/checkout") return json({ error: "boom" }, 500);
    if (url.pathname === "/shop/ok") return json({ ok: true });
    return route.fulfill({ body: SITE, contentType: "text/html" });
  });
  await p.goto(`${ORIGIN}/${hash}`);
  await p.waitForTimeout(1000);
  return { p, errors, reports, close: () => ctx.close() };
}

const pillText = (p: Page) =>
  p.evaluate(() => {
    const el = document
      .getElementById("loki-feedback-host")
      ?.shadowRoot?.querySelector(".watch-pill .wtext") as HTMLElement | null;
    return el?.innerText ?? null;
  });
/** The pill's last button is Pause / Resume (Report sits before it). */
const clickPillButton = (p: Page) =>
  p.evaluate(() => {
    const all = document
      .getElementById("loki-feedback-host")!
      .shadowRoot!.querySelectorAll(".watch-pill .wbtn");
    (all[all.length - 1] as HTMLElement).click();
  });

async function main() {
  let browser: Browser;
  try {
    browser = await chromium.launch(
      process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    );
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    if (process.env.CI) {
      console.error(`✗ Chromium is required under CI and could not launch: ${why}`);
      process.exit(1);
    }
    console.log(`↷ skipped: no Chromium on this machine (${why}). CI runs it.`);
    process.exit(0);
  }
  const out = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const js = out.outputFiles[0].text;

  // ---- the owner: watched, visibly, and a failure files one report ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    // The owner link opens the note panel; close it to use the page.
    await s.p.keyboard.press("Escape");
    ok(
      (await pillText(s.p))?.startsWith("Loki is watching") === true,
      "owner sees the watching pill",
    );
    await s.p.fill("#email", "me@example.com");
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    ok(s.reports.length === 1, `one report for one cause (got ${s.reports.length})`);
    const r = s.reports[0]?.suggestion ?? "";
    ok(r.includes("POST /shop/checkout → 500"), "the report names the failed request");
    ok(r.includes("button “Buy now”"), "the report carries the tap that led there");
    ok(!r.includes("me@example.com"), "what was typed never leaves the page");
    ok(!r.includes("token=secret"), "query strings never leave the page");
    ok(s.reports[0]?.ownerPass === "pass123", "the report is the owner's, so it starts a fix");
    ok(
      (await pillText(s.p))?.includes("Loki is fixing") === true,
      "the pill says it is being fixed",
    );
    ok(s.errors.length === 0, `no page errors (${s.errors.join("; ")})`);
    await s.close();
  }

  // ---- a button that does nothing, and one that works ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    for (let i = 0; i < 3; i++) await s.p.click("#ok");
    await s.p.waitForTimeout(400);
    ok(s.reports.length === 0, "a working button tapped three times is not reported");
    for (let i = 0; i < 3; i++) await s.p.click("#dead");
    await s.p.waitForTimeout(400);
    ok(s.reports.length === 1, `a dead button files one report (got ${s.reports.length})`);
    ok(
      (s.reports[0]?.suggestion ?? "").includes(
        "tapped button “Save” three times and nothing happened",
      ),
      "the report says which button did nothing",
    );
    // Report opens the note with the trail attached.
    await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      (r.querySelectorAll(".watch-pill .wbtn")[0] as HTMLElement).click();
    });
    await s.p.waitForTimeout(300);
    const opened = await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const diag = r.querySelector(".diag") as HTMLElement | null;
      return !!r.querySelector(".panel") && diag?.style.display === "block";
    });
    ok(opened, "Report opens the note with the trail attached");
    await s.close();
  }

  // ---- paused: says so, and records nothing ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    await clickPillButton(s.p);
    ok((await pillText(s.p))?.startsWith("Loki paused") === true, "pause is visible");
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    ok(s.reports.length === 0, "paused, a failure files nothing");
    await clickPillButton(s.p); // leave it resumed for the next context
    await s.close();
  }

  // ---- a visitor: no pill, no recording ----
  {
    const s = await open(browser, js, "");
    ok((await pillText(s.p)) === null, "a visitor gets no pill");
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    ok(s.reports.length === 0, "a visitor's failures are not reported automatically");
    await s.close();
  }

  await browser.close();
  console.log(`widget-watch-browser: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();
