import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import tailwind from "@tailwindcss/postcss";
import { resolvePlaceDirective } from "../../widget/placement";

async function main() {
  // Use the app's actual stylesheet, including its imported shared composer styles.
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
        import{LokiWorkspace}from'./src/components/loki/LokiWorkspace';
        import{MobileNav}from'./src/components/shell/MobileNav';
        import{TerminalMobileHeader}from'./src/components/terminal/TerminalMobileHeader';
        import{MarkdownText}from'./src/components/ui/markdown-text';
        const controls=new URLSearchParams(location.search).has('controls');
        createRoot(document.getElementById('app')).render(controls?
          <main className="app-page"><TerminalMobileHeader title="Loki" agent="Claude" state="live"
            onOpenSheet={()=>{}} view="terminal" onViewChange={()=>{}}/>
            <MarkdownText text="Checked the homepage [F40, F40]. Unknown [F999]."
              citations={{F40:{label:'Homepage HTML',detail:'Fetched today. HTML only; no signed-in workflow checked.'}}}/></main>:
          <div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary">
            <div className="app-main-column"><div className="ui-app-topbar"><span style={{height:48}}>Loki</span></div>
            <div style={{height:48,minHeight:48}}>Account notice</div>
            <main className="app-main"><div className="app-page ui-loki-page app-viewport-pane flex flex-col" data-fc-place="tab">
              <LokiWorkspace initialProjects={[]} initialConversations={[]}/></div></main></div><MobileNav/></div>);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "navigation-fixture",
        setup(b) {
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "navigation",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents:
              "export const useRouter=()=>({push(url){window.__lastNavigation=url},replace(){},refresh(){},back(){},prefetch(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>'/loki';",
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        (window as unknown as { process: unknown }).process = { env: { NODE_ENV: "production" } };
      });
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/")) {
          let data: unknown = { ok: true };
          if (url.pathname === "/api/away") data = { status: { state: "none" } };
          if (url.pathname === "/api/control/start-my-day")
            data = {
              projects: [],
              selectedIds: [],
              catalog: [],
              maxProjects: 3,
              githubChecked: true,
            };
          if (url.pathname === "/api/loki/suggestions") data = { suggestions: [], total: 0 };
          if (url.pathname === "/api/conversations") data = { conversations: [] };
          if (url.pathname.startsWith("/api/conversations/")) data = { messages: [] };
          if (url.pathname === "/api/user-projects") data = [];
          return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        }
        return route.fulfill({
          contentType: "text/html",
          body: `<style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
        });
      });
      async function mount(query: string) {
        await page.goto(`http://mobile.fixture/loki${query}`);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.locator("textarea").or(page.locator(".ui-term-mhead-title")).first().waitFor();
      }
      await mount("");
      const fresh = await page.evaluate(() => ({
        composer: document.querySelector("textarea")!.getBoundingClientRect().toJSON(),
        viewport: innerHeight,
        navShown: getComputedStyle(document.querySelector(".ui-mobile-nav")!).display !== "none",
        topbarShown: getComputedStyle(document.querySelector(".ui-app-topbar")!).display !== "none",
        header: document.querySelector(".ui-loki-thread-header")?.getBoundingClientRect().toJSON(),
        places: [...document.querySelectorAll("[data-fc-place]")].map((e) =>
          e.getAttribute("data-fc-place"),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      // The start screen owns the phone like a thread does: no bottom tabs
      // under the composer, no app bar over the greeting, the page's own
      // floating header instead (owner, 2026-10-21).
      assert.equal(fresh.navShown, false, "the start screen has no bottom tabs");
      assert.equal(fresh.topbarShown, false, "the start screen has no app top bar");
      assert(fresh.header && fresh.header.top >= 0, "the start screen's own header is on screen");
      assert(fresh.composer.bottom <= fresh.viewport, "the input sits inside the screen");
      assert.equal(fresh.overflow, false);
      await page.getByRole("button", { name: "Loki menu" }).click();
      await page.getByRole("menuitem", { name: "Home" }).click();
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { __lastNavigation: string }).__lastNavigation,
        ),
        "/control",
        "Home is one tap from the start screen's menu",
      );
      assert.equal(resolvePlaceDirective(fresh.places), "tab");
      await mount("?c=00000000-0000-4000-8000-000000000001");
      await page.locator(".ui-loki-workspace").waitFor();
      const places = await page
        .locator("[data-fc-place]")
        .evaluateAll((nodes) => nodes.map((e) => e.getAttribute("data-fc-place")));
      assert.equal(
        resolvePlaceDirective(places),
        "tab",
        "the app conversation keeps the launcher, as the slim edge tab — never hidden",
      );
      await page.getByRole("button", { name: "Conversation menu" }).click();
      await page.getByRole("menuitem", { name: "Report a problem" }).click();
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { __lastNavigation: string }).__lastNavigation,
        ),
        "/support",
      );
      await mount("?controls=1");
      const title = await page
        .locator(".ui-term-mhead-title")
        .evaluate((e) => ({ width: e.clientWidth, textWidth: e.scrollWidth }));
      assert(title.width >= title.textWidth, "the session name must keep its letters on a phone");
      assert.equal(await page.getByRole("button", { name: "View 1 source" }).count(), 1);
      assert(!(await page.locator("body").innerText()).includes("F999"));
      const trigger = page.getByRole("button", { name: "View 1 source" });
      const box = await trigger.boundingBox();
      assert(box && box.height >= 44, "source notes need a finger-sized target");
      await trigger.click();
      await page.getByRole("dialog", { name: "Source details" }).waitFor();
      assert(
        await page
          .getByText("Fetched today. HTML only; no signed-in workflow checked.")
          .isVisible(),
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
        "View 1 source",
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `✓ ${width}px: composer clearance, quiet conversation, readable session and accessible source dialog`,
      );
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
