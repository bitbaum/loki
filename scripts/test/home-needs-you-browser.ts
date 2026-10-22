/**
 * Home's "Needs you" at 390px, as the owner met it (2026-10-19): "Grok is not
 * installed on the cloud builder" in a column a third of the screen wide,
 * beside "Open on Control" and a Retry that fails the same way forever.
 *
 * Now the card says what happened in words, at full width, and its one button
 * is the fix: "Use Claude instead" re-runs the same work on an agent the
 * builder has. A task that stopped offers "Ask it to finish".
 *
 * Run: npx tsx scripts/test/home-needs-you-browser.ts
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
  const now = new Date().toISOString();
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';
        import{AttentionBar}from'./src/components/control/AttentionBar';
        import{ControlDone}from'./src/components/control/ControlNow';
        window.switched=[];window.finished=[];
        createRoot(document.getElementById('app')).render(<main className="app-page space-y-6">
          <AttentionBar items={[]} failedCommands={[{id:'11111111-1111-4111-8111-111111111111',tab:'loki',type:'dispatch',executedAt:'${now}',error:'Grok is not installed on the cloud builder, so nothing was started. Switch this project to an agent installed there, or install Grok on the cloud builder, then try again.'}]}
            switchFor={()=>({id:'claude',label:'Claude'})} onSwitchAgent={(t,a)=>window.switched.push([t,a])}/>
          <ControlDone jobs={[{key:'r1',tab:'loki',title:'Fix the settings page',headline:'Fix the settings page',outcome:'Stopped with an error',tone:'bad',result:'',at:Date.now(),links:[{label:'See what happened',href:'/terminal?tab=loki'}]}]}
            onFinish={async t=>{window.finished.push(t)}}/>
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
    console.log("↷ home-needs-you skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 780 },
      isMobile: true,
      hasTouch: true,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const retries: unknown[] = [];
    await page.route("**/*", async (r) => {
      const url = r.request().url();
      if (url.includes("/retry")) {
        retries.push(JSON.parse(r.request().postData() ?? "{}"));
        return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
      }
      return r.fulfill(
        url.includes("/api/")
          ? { contentType: "application/json", body: "{}" }
          : {
              contentType: "text/html",
              body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
            },
      );
    });
    await page.goto("http://home.fixture/control");
    await page.evaluate(() =>
      Object.assign(window, { process: { env: { NODE_ENV: "production" } } }),
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    // A failure is one row (design reset, 2026-10): what happened as the
    // title, why on the grey line, and the fix as the row's one button.
    const card = page.locator("#control-attention .ui-listrow").first();
    await card.waitFor();
    assert.equal(
      (await card.locator(".ui-listrow-title").textContent())?.trim(),
      "Couldn't start work in Loki",
      "the title says what happened, in words",
    );
    const body = (await card.locator(".ui-listrow-secondary-text").textContent()) ?? "";
    assert.match(body, /^Grok is not installed on the cloud builder, so nothing was started\./);
    assert.doesNotMatch(body, /Switch this project/, "the advice is the button, not a sentence");
    const width = await card
      .locator(".ui-listrow-secondary-text")
      .evaluate((e) => e.getBoundingClientRect().width);
    assert.ok(
      width > 160,
      `the reason has the row's width, not a third of it (${Math.round(width)}px)`,
    );
    assert.equal(await page.getByText("Open on Control").count(), 0, "no way to the page it is on");
    fs.mkdirSync(".tmp/home", { recursive: true });
    await page.screenshot({ path: ".tmp/home/needs-you-390.png" });

    await card.getByRole("button", { name: "Use Claude" }).click();
    await page.locator("#control-attention").waitFor({ state: "detached" });
    assert.deepEqual(retries, [{ agent: "claude" }], "the same work, on an agent the builder has");
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { switched: unknown }).switched),
      [["loki", "claude"]],
      "and it becomes the project's agent",
    );

    await page.getByRole("button", { name: "Ask it to finish" }).click();
    await page.getByText("Asked — it shows above").waitFor();
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { finished: unknown }).finished),
      ["loki"],
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(errors, []);
    console.log("✓ home-needs-you: each failure carries its fix, in words, at full width");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("✗ home-needs-you:", e instanceof Error ? e.message : e);
  process.exit(1);
});
