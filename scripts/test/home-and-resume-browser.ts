/**
 * Two flows walked as the owner would, on a 390px phone (2026-10-19):
 *
 *  1. Home: "I want something built." The box is the first thing on the
 *     page, it says which project, a tap changes the project, and what is
 *     sent goes to THAT project with a sentence saying where it went. No
 *     orange slab, no "Start something" that leaves the page.
 *  2. Terminal, nothing open: "Where is my session?" Your projects, each one
 *     tap from Resume — the request asks the builder to continue the last
 *     Claude conversation — instead of a form with two dropdowns.
 *
 * Run: npx tsx scripts/test/home-and-resume-browser.ts
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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';
        import{HomeComposer}from'./src/components/control/HomeComposer';
        import{TerminalResume}from'./src/components/terminal/TerminalResume';
        const root=createRoot(document.getElementById('app'));
        window.sent=[];
        window.mount=(which)=>root.render(<main className="app-page">{which==='home'
          ?<HomeComposer projects={[{tab:'Bitbaum'},{tab:'Center SOM',detail:'Being built now'},{tab:'loki'}]}
              onSend={async(tab,text)=>{window.sent.push([tab,text]);return{mode:'direct',runnerConnected:true,commandId:null}}}/>
          :<TerminalResume projects={[{name:'loki',dir:'/d/loki',agentPref:null},{name:'Bitbaum',dir:'/d/bitbaum',agentPref:null},{name:'petvity',dir:'/d/petvity',agentPref:'grok'}]}
              agents={[{id:'claude',label:'Claude'},{id:'grok',label:'Grok'}]} defaultAgent="claude"
              activeProject="Bitbaum" channel="cloud" openTabs={[]} onStarted={t=>{window.started=t}} onAllProjects={()=>{window.all=true}}/>}</main>);`,
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
          b.onResolve({ filter: /^(?:next\/navigation|@\/hooks\/use-fleet-project)$/ }, (a) => ({
            path: a.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            loader: "js",
            contents: a.path.includes("use-fleet-project")
              ? "export const useFleetProject=()=>'loki'"
              : "export const usePathname=()=>'/control';export const useRouter=()=>({push(u){window.pushed=u},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();",
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
    console.log("↷ home-and-resume skipped: Chromium unavailable; CI runs it");
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
    const launches: unknown[] = [];
    await page.route("**/*", async (r) => {
      if (r.request().url().includes("/api/agent/launch")) {
        launches.push(JSON.parse(r.request().postData() ?? "{}"));
        return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
      }
      return r.fulfill(
        r.request().url().includes("/api/")
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
    fs.mkdirSync(".tmp/home", { recursive: true });
    const call = (which: string) =>
      page.evaluate((w) => (window as unknown as { mount: (w: string) => void }).mount(w), which);

    // ── 1. Home: the box, in the project you were last in ────────────────
    await call("home");
    const chip = page.getByRole("button", { name: /^Project: / });
    await chip.waitFor();
    assert.equal(
      await chip.getAttribute("aria-label"),
      "Project: Loki. Change the project",
      "the box starts in the project you were last in",
    );
    await chip.click();
    const sheet = page.getByRole("dialog", { name: "Build in" });
    await sheet.getByRole("button", { name: /^Bitbaum/ }).click();
    await sheet.waitFor({ state: "detached" });
    assert.match((await chip.getAttribute("aria-label")) ?? "", /^Project: Bitbaum\./);
    await page.locator("textarea").fill("Add a contact form");
    await page.getByRole("button", { name: /^Send/ }).click();
    await page.getByRole("status").getByText("Sent to Bitbaum").waitFor();
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
      [["Bitbaum", "Add a contact form"]],
      "it goes to the project the chip names",
    );
    // Somewhere new: "New project" in the same sheet, and the words become
    // the new project's description (owner, 2026-10-19).
    await chip.click();
    await sheet.getByRole("button", { name: /^New project/ }).click();
    await sheet.waitFor({ state: "detached" });
    assert.match((await chip.getAttribute("aria-label")) ?? "", /^Project: New project\./);
    await page.locator("textarea").fill("A booking page for my bakery");
    await page.getByRole("button", { name: /^Send/ }).click();
    await page.waitForFunction(() => Boolean((window as unknown as { pushed?: string }).pushed));
    assert.equal(
      await page.evaluate(() => (window as unknown as { pushed: string }).pushed),
      "/projects?new=1&description=A%20booking%20page%20for%20my%20bakery",
      "a new project starts from the words in the box",
    );
    const orange = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => {
        const c = getComputedStyle(b).backgroundColor;
        const m = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
        return m.length >= 3 && m[0]! > 200 && m[1]! < 140 && m[2]! < 60;
      }),
    );
    assert.equal(orange, false, "no orange button on Home");
    await page.screenshot({ path: ".tmp/home/home-390.png" });

    // ── 2. Terminal with nothing open: Resume, not a form ─────────────────
    await call("resume");
    await page.getByRole("button", { name: "Resume Bitbaum" }).waitFor();
    assert.equal(await page.locator("select").count(), 0, "no dropdowns");
    const rows = await page.getByRole("list", { name: "Your projects" }).getByRole("button").all();
    assert.match(
      (await rows[0]!.textContent()) ?? "",
      /^Bitbaum/,
      "the project in scope comes first",
    );
    assert.ok(
      await page.getByRole("button", { name: "Start petvity" }).isVisible(),
      "an agent with no conversation to reopen says Start",
    );
    await page.screenshot({ path: ".tmp/home/resume-390.png" });
    await page.getByRole("button", { name: "Resume Bitbaum" }).click();
    await page.getByRole("status").getByText("Opening Bitbaum").waitFor();
    assert.equal(launches.length, 1);
    const sent = launches[0] as Record<string, unknown>;
    assert.equal(sent.resume, true, "Resume asks the builder to continue the last conversation");
    assert.equal(sent.agent, "claude");
    assert.equal(sent.dir, "/d/bitbaum");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
      "nothing scrolls sideways",
    );
    assert.deepEqual(errors, []);
    console.log("✓ home-and-resume: the box sends to the named project; Resume, not a form");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("✗ home-and-resume:", e instanceof Error ? e.message : e);
  process.exit(1);
});
