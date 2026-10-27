/**
 * The plain shell's way in, on a 390px phone: with nothing open, "Plain shell"
 * is a row like the projects above it (44px+, no sideways scroll, a label that
 * says what happens); opening it asks for the PIN first, then opens ON THE
 * BUILDER THE SCREEN NAMES; and for anyone but the operator it is not there.
 *
 * Run: npx tsx scripts/test/plain-shell-browser.ts
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
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss") as (
    plugins: unknown[],
  ) => { process(css: string, options: { from: string }): Promise<{ css: string }> };
  const from = path.resolve("src/app/globals.css");
  const styles = await postcss([tailwind()]).process(fs.readFileSync(from, "utf8"), { from });
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
        import{usePlainShell}from'./src/components/terminal/use-plain-shell';
        import{ShellEntryRows,ShellPinSheet,ShellBanner,ShellLockedPanel}from'./src/components/terminal/PlainShell';
        function Screen(){
          const [tabs]=useState([]);
          const shell=usePlainShell('cloud',tabs,t=>{window.selected=t});
          return <main className="app-page"><ShellEntryRows shell={shell}/><ShellPinSheet shell={shell}/><div id="chrome"><ShellBanner channel="cloud" onLock={()=>{}}/><ShellLockedPanel shell={shell}/></div></main>;
        }
        createRoot(document.getElementById('app')).render(<Screen/>);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve({ filter: /^next\/link$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            resolveDir: process.cwd(),
            contents:
              "import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children)}",
          }));
        },
      },
    ],
  });
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ plain-shell-browser skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    for (const operator of [true, false]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 780 },
        isMobile: true,
        hasTouch: true,
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const calls: string[] = [];
      let unlocked = false;
      await page.route("**/*", async (r) => {
        const url = new URL(r.request().url());
        const json = (body: unknown, status = 200) =>
          r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === "/api/shell/status") {
          return json(
            operator
              ? {
                  allowed: true,
                  pinConfigured: true,
                  unlocked,
                  idleMinutes: 10,
                  online: true,
                  open: 0,
                  max: 3,
                }
              : { allowed: false, pinConfigured: false, unlocked: false },
          );
        }
        if (url.pathname === "/api/shell/unlock") {
          calls.push(`unlock ${r.request().postData()}`);
          unlocked = true;
          return json({ ok: true });
        }
        if (url.pathname === "/api/shell/open") {
          calls.push(`open ${r.request().postData()}`);
          return json({ ok: true, tab: "loki-shell-a1b2c3d4", channel: "cloud" });
        }
        if (url.pathname.startsWith("/api/")) return json({});
        return r.fulfill({
          contentType: "text/html",
          body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
        });
      });
      await page.goto("http://shell.fixture/terminal");
      await page.evaluate(() =>
        Object.assign(window, { process: { env: { NODE_ENV: "production" } } }),
      );
      await page.addScriptTag({ content: bundle.outputFiles[0].text });

      if (!operator) {
        await page.waitForTimeout(500);
        assert.equal(
          await page.getByText("Plain shell").count(),
          0,
          "not the operator: no entry at all",
        );
        assert.equal(await page.getByRole("dialog").count(), 0);
        await page.close();
        continue;
      }

      const row = page.getByRole("button", { name: "Open a plain shell on the cloud builder" });
      await row.waitFor();
      const box = (await row.locator("xpath=ancestor::li").boundingBox())!;
      assert.ok(box.height >= 44, `the row is a 44px target (${box.height})`);
      assert.ok(box.width <= 390, "the row fits the phone");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        "no sideways scroll at 390px",
      );
      await page.getByText("A command line on the cloud builder, no project").waitFor();

      // The shell's own chrome: it says what it is, in a 44px bar, within the phone.
      const bar = page.getByRole("note");
      await bar.getByText("Real shell").waitFor();
      assert.match(
        (await bar.textContent()) ?? "",
        /Real shell on the cloud builder · no project, no agent/,
      );
      assert.ok((await bar.boundingBox())!.height >= 44, "the bar is a 44px target row");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        "the locked panel fits 390px",
      );
      await page.screenshot({ path: ".tmp/plain-shell/chrome-390.png" });

      // Locked: the PIN comes first, and nothing is opened until it is right.
      await row.click();
      const sheet = page.getByRole("dialog", { name: "Unlock the shell" });
      await sheet.waitFor();
      assert.deepEqual(calls, [], "nothing opened before the PIN");
      await sheet.getByLabel("PIN for the shell").fill("4821");
      await sheet.getByRole("button", { name: "Unlock the shell" }).click();
      await page.waitForFunction(
        () => (window as unknown as { selected?: string }).selected === undefined,
      );
      await page.waitForTimeout(400);
      assert.deepEqual(
        calls,
        ['unlock {"pin":"4821"}', 'open {"channel":"cloud"}'],
        "PIN, then a shell on the cloud builder",
      );
      assert.deepEqual(errors, [], "no page errors");
      fs.mkdirSync(".tmp/plain-shell", { recursive: true });
      await page.screenshot({ path: ".tmp/plain-shell/entry-390.png" });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("✓ plain-shell-browser: a row at 390px, the PIN first, the operator only");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
