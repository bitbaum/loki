import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

async function main() {
  const from = path.resolve("src/app/globals.css");
  const styles = await postcss([tailwind()]).process(fs.readFileSync(from, "utf8"), { from });
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const reviewId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const eventId = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {InspectionWorkspace} from './src/components/inspection/InspectionWorkspace';
    import {MobileNav} from './src/components/shell/MobileNav';
    createRoot(document.getElementById('app')).render(<div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary"><div className="app-main-column"><main className="app-main"><div className="app-page mx-auto max-w-7xl"><InspectionWorkspace projectId="${id}" projectName="Loki" initialReview={null} hasWebsite hasCode /></div></main></div><MobileNav/></div>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
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
            contents: `export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){}}); export const usePathname=()=>'/projects/${id}/review'; export const useSearchParams=()=>new URLSearchParams();`,
          }));
        },
      },
    ],
  });
  const out = path.resolve(".tmp/inspection-workspace");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const sample = await browser.newPage({ viewport: { width: 390, height: 760 } });
    await sample.setContent(
      '<html><body style="margin:0;padding:32px;font:18px system-ui;background:#fff;color:#222"><p>Example site · recorded browser view</p><h1 style="font-size:40px;margin-top:80px">A calmer place to build.</h1><p style="line-height:1.6">Bring your idea. Make it useful.</p><button style="padding:16px;border:0;background:#222;color:white;border-radius:12px;font:inherit">Start a project</button></body></html>',
    );
    const image = await sample.screenshot({ type: "jpeg" });
    await sample.close();
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error("Browser error:", e.message);
      });
      await page.addInitScript(() => {
        (window as unknown as { process: unknown }).process = { env: { NODE_ENV: "production" } };
      });
      const review = {
        id: reviewId,
        projectId: id,
        mode: "full",
        status: "running",
        workerState: "running",
        heartbeatAt: new Date().toISOString(),
        frame: {
          url: "https://example.orangecat.ch/",
          image: `/api/reviews/${reviewId}/frame?key=sample`,
          width: 390,
          height: 760,
          scrollY: 0,
          action: "Checking the home page on phone",
        },
        coverage: [
          {
            url: "https://example.orangecat.ch/",
            width: 390,
            result: "visited",
            detail: "First screen viewed. Forms were not submitted.",
          },
        ],
      };
      const events: Array<Record<string, unknown>> = [
        {
          id: eventId,
          kind: "finding",
          text: "Navigation is difficult to find",
          finding: {
            title: "Navigation is difficult to find",
            detail: "People cannot easily find a way to their projects.",
            category: "visual",
            evidence: "The project link is hidden in a small menu at the bottom.",
            location: "/ · phone",
          },
          image: null,
          runId: null,
        },
        {
          id: "observation",
          kind: "assistant",
          text: "I’m checking whether the first screen makes the next step clear.",
        },
      ];
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/frame"))
          return route.fulfill({ contentType: "image/jpeg", body: image });
        if (url.pathname === `/api/projects/${id}/reviews`)
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ review }),
          });
        if (url.pathname === `/api/reviews/${reviewId}`) {
          if (route.request().method() === "POST") {
            const body = route.request().postDataJSON();
            if (body.action === "pause" || body.action === "discuss") {
              review.status = "paused";
              review.workerState = "paused";
            }
            if (body.action === "resume") {
              review.status = "running";
              review.workerState = "running";
            }
            if (body.action === "discuss")
              events.push(
                { id: "question", kind: "user", text: body.text },
                {
                  id: "answer",
                  kind: "assistant",
                  text: "The main action should sit beside the project title. That makes the next step easier to find.",
                },
              );
            if (body.action === "fix") {
              review.status = "stopped";
              events[0].runId = "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee";
              events.push({
                id: "dispatch",
                kind: "dispatch",
                text: "Fix requested: Navigation is difficult to find",
                runId: events[0].runId,
              });
            }
          }
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ review, events }),
          });
        }
        if (url.pathname.startsWith("/api/"))
          return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
        return route.fulfill({
          contentType: "text/html",
          body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}:root{--font-heading:system-ui,sans-serif;--font-sans:system-ui,sans-serif}body{font-family:system-ui,sans-serif}</style></head><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`,
        });
      });
      await page.goto(`http://fixture.local/projects/${id}/review`);
      await page.getByRole("heading", { name: "What should we check?" }).waitFor();
      await page.screenshot({ path: `${out}/${width}-choose-light.png`, fullPage: true });
      assert.equal(await page.getByRole("radio").count(), 4);
      await page.getByRole("button", { name: "Start review", exact: true }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByText("Paused · ready to discuss", { exact: true }).waitFor();
      assert.equal(await page.getByRole("img", { name: /Browser view of/ }).count(), 1);
      const textbox = page.getByRole("textbox", { name: "Discuss the review with Loki" });
      await textbox.fill("How would you improve this?");
      await textbox.press("Enter");
      await page
        .getByText("The main action should sit beside the project title.", { exact: false })
        .last()
        .waitFor();
      assert.equal(await textbox.inputValue(), "");
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      for (const dark of [false, true]) {
        await page.evaluate(
          (value) => document.documentElement.classList.toggle("dark", value),
          dark,
        );
        await page.waitForTimeout(250);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${width}: no horizontal overflow`,
        );
        await page.locator(".app-main").evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${out}/${width}-${dark ? "dark" : "light"}.png`,
          fullPage: true,
        });
        await page
          .locator(".ui-inspection-layout")
          .screenshot({ path: `${out}/${width}-${dark ? "dark" : "light"}-stage.png` });
      }
      await page.getByRole("button", { name: "Request fix", exact: true }).click();
      await page.getByRole("button", { name: "Fix requested", exact: true }).waitFor();
      await page.getByRole("link", { name: "Watch the fix →" }).waitFor();
      await page.getByText("Review stopped · progress saved", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `Inspection workspace ${width}px: scope, pause, discussion, resume, fix handoff and both themes passed`,
      );
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
