/**
 * The terminal pane before its first live frame, as a phone shows it: words
 * saying it is on its way, then the remembered last screen marked as not yet
 * live, then the live screen with nothing over it.
 *
 * It used to be a black pane for the seconds the runner took to answer, then
 * the terminal "a little bit later" (owner, 2026-10-18), and a user "would
 * think, what's going on? It's not working."
 *
 * Run: npx tsx scripts/test/terminal-opening-browser.ts
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
      createRoot(document.getElementById('app')).render(<div style={{height:600,display:'flex',flexDirection:'column'}}><TerminalView transport={transport} fill compactChrome/></div>);`,
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
    console.log("↷ terminal opening skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) =>
      r.fulfill(
        r.request().url().includes("/api/")
          ? { contentType: "application/json", body: "{}" }
          : {
              contentType: "text/html",
              body: `<style>${styles.css}${xtermCss}</style><div id="app"></div>`,
            },
      ),
    );
    await page.goto("http://terminal.fixture/terminal");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => Boolean((window as unknown as { h?: unknown }).h));
    type H = {
      onConnected: (c: boolean) => void;
      onCached?: (c: boolean) => void;
      onReset: () => void;
      onOutput: (d: string) => void;
    };
    const frame = (text: string, cached: boolean) =>
      page.evaluate(
        ([t, c]) => {
          const h = (window as unknown as { h: H }).h;
          h.onCached?.(c as boolean);
          h.onReset();
          h.onOutput(t as string);
        },
        [text, cached] as const,
      );

    fs.mkdirSync(".tmp/terminal-opening", { recursive: true });
    await page.evaluate(() => (window as unknown as { h: H }).h.onConnected(true));
    await page.getByText("Opening the screen…").waitFor();
    await page.screenshot({ path: ".tmp/terminal-opening/waiting-390.png" });

    await frame("claude> remembered screen", true);
    await page.getByText("Last screen · updating").waitFor();
    assert.equal(await page.getByText("Opening the screen…").count(), 0, "the screen replaces it");
    await page.screenshot({ path: ".tmp/terminal-opening/cached-390.png" });

    // The remembered screen is not proof of life: the stall watchdog still
    // runs, and only a live frame clears it.
    await frame("claude> live screen", false);
    await page.waitForFunction(() => !document.body.textContent?.includes("Last screen"));
    assert.equal(await page.getByRole("status").count(), 0, "nothing over the live screen");
    await page.screenshot({ path: ".tmp/terminal-opening/live-390.png" });

    // A later remembered copy (another viewer joining) never re-marks a live pane.
    await frame("claude> again", true);
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("Last screen · updating").count(), 0, "live stays live");
    assert.deepEqual(errors, []);
    console.log(
      "✓ terminal-opening: words while it opens, the last screen marked, nothing over the live one",
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  console.error(`✗ terminal-opening: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
