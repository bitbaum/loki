/**
 * Home's "Being built" row for a project that waits on its owner, at 390px in
 * light and dark, as the owner met it on a phone (2026-11-12): "Waiting for
 * you · Waiting for your answer", the state twice and the question nowhere.
 *
 * Now the row says the canonical state once, then the question in one line,
 * and the answer goes from right there to that project's agent.
 *
 * Run: npx tsx scripts/test/home-being-built-browser.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import tailwind from "@tailwindcss/postcss";

const QUESTION = "Should the shop show prices with or without VAT on the product page?";

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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';
        import{ControlNow}from'./src/components/control/ControlNow';
        import{buildNowJobs}from'./src/components/control/control-now';
        const now=Date.now();
        const snap=(tab,phase,over)=>({phase,project:{tab,liveTab:tab,session:null,profile:null,currentPrompt:null,liveAgentTurns:null,latestOrchestrationRun:null,...over}});
        const jobs=buildNowJobs([
          snap('kivvi','awaiting_you',{session:{blockReason:${JSON.stringify(QUESTION)}}}),
          snap('center-com','working',{latestOrchestrationRun:{id:'r1',adapter:'claude',intent:'custom',state:'running',title:'Rebuild the header',startedAt:new Date(now-12*60000).toISOString(),finishedAt:null,summary:null,payload:null,lastProgressAt:new Date(now-30000).toISOString(),lastStep:{text:'Editing Header.tsx',at:new Date(now-30000).toISOString()}}}),
        ],now);
        window.replies=[];
        createRoot(document.getElementById('app')).render(<main className="app-page space-y-6">
          <ControlNow jobs={jobs} nowMs={now} onReply={async(t,x)=>{window.replies.push([t,x])}}/>
        </main>);`,
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
          b.onResolve({ filter: /^next\/navigation$/ }, (a) => ({
            path: a.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents:
              "export const usePathname=()=>'/control';export const useRouter=()=>({push(){},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();",
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
    console.log("↷ home-being-built skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    fs.mkdirSync(".tmp/home", { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 640 },
        isMobile: true,
        hasTouch: true,
        colorScheme: theme,
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (r) =>
        r.fulfill({
          contentType: "text/html",
          body: `<html class="${theme}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}html,body{font-family:system-ui,sans-serif!important;background:var(--surface-page)}</style><body><div id="app"></div></body></html>`,
        }),
      );
      await page.goto("http://home.fixture/control");
      await page.evaluate(() =>
        Object.assign(window, { process: { env: { NODE_ENV: "production" } } }),
      );
      await page.addScriptTag({ content: bundle.outputFiles[0].text });

      const list = page.getByRole("list", { name: "Being built" });
      await list.waitFor();
      const row = list.locator(".ui-listrow").first();
      const line = ((await row.locator(".ui-listrow-secondary-text").textContent()) ?? "").trim();
      assert.equal(line, `Needs you · ${QUESTION}`, `${theme}: the state once, then the question`);
      assert.doesNotMatch(line, /Waiting for/, `${theme}: no second word for the state`);
      assert.equal(
        await row.locator(".ui-listrow-secondary-text").evaluate((e) => {
          const s = getComputedStyle(e);
          return s.whiteSpace === "nowrap" && s.textOverflow === "ellipsis";
        }),
        true,
        `${theme}: the question is one line`,
      );

      // The working row has no reply field: only the row that waits.
      assert.equal(await page.locator(".ui-home-reply").count(), 1, `${theme}: one reply, its own`);
      const input = page.getByRole("textbox", { name: /^Reply to Kivvi/i });
      const box = await input.boundingBox();
      assert.ok(box && box.width >= 150, `${theme}: the field is wide enough to type in`);
      assert.ok(box && box.height >= 44, `${theme}: and tall enough to tap`);
      const send = page.getByRole("button", { name: "Send" });
      assert.equal(await send.isDisabled(), true, `${theme}: nothing to send yet`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
      await page.screenshot({ path: `.tmp/home/being-built-390-${theme}.png` });

      await input.fill("With VAT, please");
      await send.click();
      await page
        .getByRole("status")
        .filter({ hasText: /^Sent to Kivvi$/i })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() => (window as unknown as { replies: unknown }).replies),
        [["kivvi", "With VAT, please"]],
        `${theme}: the reply went to that project's agent`,
      );
      assert.deepEqual(errors, [], `${theme}: no page errors`);
      await page.close();
    }
    console.log(
      "✓ home-being-built: 'Needs you' once, the question, and a reply from the row (390px, light and dark)",
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("✗ home-being-built:", e instanceof Error ? e.message : e);
  process.exit(1);
});
