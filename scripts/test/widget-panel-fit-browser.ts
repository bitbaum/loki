// A visitor's first look at the panel must be whole: the greeting's first line
// is not cut under the header, the "Talk to Loki" hero is not sliced by what is
// under it, and the way in for the owner is there — on a small phone (320x640)
// and a normal one (390x800). Found 2026-10-23 driving the real bundle with a
// microphone: the thread opened scrolled to its bottom with the greeting half
// hidden, and on a short phone the hero was cut in half and the door was gone.
// Run: npx tsx scripts/test/widget-panel-fit-browser.ts (needs Chromium; CI has it).
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PALETTE } from "../../src/lib/palette";

const ORIGIN = "http://host.fixture";
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Farmhouse</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main><h1>Welcome to the farm</h1><p>Stay with us.</p></main>
<script src="${ORIGIN}/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`;

async function main() {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ panel fit skipped: Chromium unavailable; CI runs it");
    return;
  }
  const bundle = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const js = bundle.outputFiles[0].text;
  try {
    for (const [width, height] of [
      [320, 640],
      [390, 800],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width, height } });
      const page = await ctx.newPage();
      // Every real phone has a microphone; the headless one does not.
      await page.addInitScript(`
        Object.defineProperty(Navigator.prototype, "mediaDevices", { configurable: true,
          get: () => ({ getUserMedia: () => Promise.reject(new Error("test")) }) });
        Object.defineProperty(document, "featurePolicy", { configurable: true,
          value: { allowsFeature: () => true } });
      `);
      await page.route(`${ORIGIN}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) =>
          route.fulfill({ body: JSON.stringify(body), contentType: "application/json" });
        if (path === "/widget.js")
          return route.fulfill({ body: js, contentType: "text/javascript" });
        if (path === "/api/widget-boot")
          return json({
            active: true,
            placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
            theme: PALETTE.widget,
            themes: PALETTE.widgetThemes,
          });
        if (path.startsWith("/api/")) return json({ ok: true });
        return route.fulfill({ body: PAGE, contentType: "text/html" });
      });
      await page.goto(`${ORIGIN}/`);
      await page.waitForTimeout(1200);
      await page.evaluate(() =>
        (
          document
            .getElementById("loki-feedback-host")!
            .shadowRoot!.querySelector(".fab") as HTMLElement
        ).click(),
      );
      await page.waitForTimeout(700);
      const fit = await page.evaluate(`(() => {
        const r = document.getElementById("loki-feedback-host").shadowRoot;
        const log = r.querySelector(".chatlog").getBoundingClientRect();
        const rect = (sel) => { const e = r.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
        const first = r.querySelector(".chatlog .bubble, .chatlog .msg, .chatlog > *").getBoundingClientRect();
        const hero = rect(".talk-hero");
        const door = rect(".door");
        return { log: { top: log.top, bottom: log.bottom }, first, hero, door };
      })()`);
      const label = `${width}x${height}`;
      const f = fit as {
        log: { top: number; bottom: number };
        first: { top: number };
        hero: { top: number; bottom: number } | null;
        door: { top: number; bottom: number } | null;
      };
      assert.ok(
        f.first.top >= f.log.top - 1,
        `${label}: the greeting starts inside the thread, not cut under the header`,
      );
      assert.ok(f.hero, `${label}: the Talk hero is offered`);
      assert.ok(
        f.hero!.top >= f.log.top - 1 && f.hero!.bottom <= f.log.bottom + 1,
        `${label}: the Talk hero is whole, not sliced`,
      );
      assert.ok(f.door, `${label}: the owner's way in is there`);
      assert.ok(
        f.door!.top >= f.log.top - 1 && f.door!.bottom <= f.log.bottom + 1,
        `${label}: the owner's way in is whole`,
      );
      await ctx.close();
    }
    console.log("✓ the panel's first look is whole on a small and a normal phone");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
