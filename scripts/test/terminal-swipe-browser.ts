/**
 * The terminal on a phone, scrolled with a finger: a swipe down shows older
 * output, the page never takes the swipe for itself, and a swipe past the
 * oldest line the screen kept says so and offers Chat, where the whole
 * conversation is.
 *
 * "I try to scroll through the terminal, through that black screen with code,
 * and I'm not able to" (owner, 2026-10-19). Two things made that true: the
 * host left vertical swipes to the browser to argue over, and at the top of
 * what the builder kept a swipe moved nothing and said nothing.
 *
 * Run: npx tsx scripts/test/terminal-swipe-browser.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import tailwind from "@tailwindcss/postcss";

async function main() {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const from = path.resolve("src/app/globals.css");
  const styles = await postcss([tailwind()]).process(fs.readFileSync(from, "utf8"), { from });
  const xtermCss = fs.readFileSync(require.resolve("@xterm/xterm/css/xterm.css"), "utf8");
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TerminalView}from'./src/components/terminal/TerminalView';
      const transport={key:'t',convertEol:true,connect(h){window.h=h;return()=>{}},sendKey:async()=>{},sendResize(){}};
      createRoot(document.getElementById('app')).render(<div style={{height:600,display:'flex',flexDirection:'column'}}><TerminalView transport={transport} fill compactChrome onShowChat={()=>{window.chat=true}}/></div>);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    format: "iife",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ terminal swipe skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 780 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) =>
      r.fulfill(
        r.request().url().includes("/api/")
          ? { contentType: "application/json", body: "{}" }
          : {
              contentType: "text/html",
              body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}${xtermCss}</style><div id="app"></div>`,
            },
      ),
    );
    await page.goto("http://terminal.fixture/terminal");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => Boolean((window as unknown as { h?: unknown }).h));
    await page.evaluate(() => {
      const h = (
        window as unknown as {
          h: { onConnected(c: boolean): void; onReset(): void; onOutput(d: string): void };
        }
      ).h;
      h.onConnected(true);
      h.onReset();
      // Enough lines that one swipe cannot reach the top: at 390px the fitted
      // font gives ~66 rows a screen, so 120 lines left only ~54 above the fold
      // and a 300px swipe landed exactly on the oldest line.
      h.onOutput(Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n"));
    });
    await page.waitForTimeout(300);
    const viewport = () =>
      page.evaluate(() => {
        const t = (
          document.querySelector(".xterm") as unknown as {
            _fcTerm: { buffer: { active: { viewportY: number; baseY: number } } };
          }
        )._fcTerm;
        return { y: t.buffer.active.viewportY, base: t.buffer.active.baseY };
      });
    const start = await viewport();
    assert.ok(start.base > 0 && start.y === start.base, "opens on the newest output");

    const host = page.locator(".xterm").locator("..");
    assert.equal(
      await host.evaluate((e) => getComputedStyle(e).touchAction),
      "pan-x",
      "vertical swipes belong to the terminal, not the page",
    );

    const box = (await page.locator(".xterm").boundingBox())!;
    const cdp = await context.newCDPSession(page);
    // A DRAG, not a flick: the finger stops and only then lifts. CDP delivers
    // the twelve moves a millisecond or two apart, which the scroller reads as
    // a very fast finger, and the glide after a flick runs on that speed — on
    // a quick runner one 300px swipe glided past every kept line to the top
    // and the "as far back" note appeared a swipe early (CI, 2026-10-22, twice
    // on one commit). Six still moves before the lift decay the smoothed
    // velocity to nothing (×0.2 per still move), so a swipe moves exactly
    // what the finger moved.
    const swipe = async (dy: number) => {
      const x = box.x + box.width / 2;
      const y0 = box.y + 120;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: y0 }],
      });
      for (let i = 1; i <= 12; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y0 + (dy * i) / 12 }],
        });
      }
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(30);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y0 + dy }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(900);
    };

    await swipe(300);
    const after = await viewport();
    assert.ok(after.y < start.y, `a swipe down shows older output (${start.y} → ${after.y})`);
    assert.equal(await page.getByRole("status").filter({ hasText: "as far back" }).count(), 0);

    // To the top, and once more: the screen says so, and where the rest is.
    for (let i = 0; i < 12 && (await viewport()).y > 0; i++) await swipe(400);
    assert.equal((await viewport()).y, 0, "reaches the oldest kept line");
    await swipe(200);
    const note = page
      .getByRole("status")
      .filter({ hasText: "That is as far back as this screen goes." });
    await note.waitFor();
    await page.screenshot({ path: ".tmp/terminal-swipe-390.png" });
    await note.getByRole("button", { name: "The whole conversation is in Chat" }).click();
    assert.equal(await page.evaluate(() => (window as unknown as { chat?: boolean }).chat), true);
    assert.deepEqual(errors, []);
    console.log("✓ terminal-swipe: a finger scrolls it, and the top says where the rest is");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("✗ terminal-swipe:", e instanceof Error ? e.message : e);
  process.exit(1);
});
