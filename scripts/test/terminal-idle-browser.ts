/** Actual idle-session and ChatKit composer: task startup, drafts and queued state. */
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
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import{TerminalIdleSession}from'./src/components/terminal/TerminalIdleSession';
      import{SessionComposer}from'./src/components/terminal/SessionComposer';
      const root=createRoot(document.getElementById('app'));window.written=[];
      window.mount=(key,live=false)=>root.render(<div key={key} data-mount={key} className="flex h-dvh min-w-0 flex-col bg-surface-page text-text-primary">{live?<SessionComposer tab="my-project" project="my-project" channel="cloud" agent="codex" agentLabel="Codex" live onKey={async bytes=>{window.written.push(bytes)}}/>:<TerminalIdleSession project={{name:'my-project',agentPref:'codex'}} channel="cloud" offline/>}</div>);`,
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
          b.onResolve({ filter: /^(?:next\/navigation|next\/link|next-auth\/react)$/ }, (a) => ({
            path: a.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            resolveDir: process.cwd(),
            loader: "jsx",
            contents:
              a.path === "next/link"
                ? "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}"
                : a.path === "next-auth/react"
                  ? "import{createContext}from'react';export const SessionContext=createContext(null);"
                  : "export const usePathname=()=>'/terminal';export const useRouter=()=>({push(){},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();",
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let reject = true;
    let serial = 0;
    let completed = false;
    let holdSecond: (() => void) | null = null;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/control/tab-inject" || pathname === "/api/control/chat-send") {
        posts.push({ path: pathname, body: request.postDataJSON() });
        await route.fulfill({
          status: reject ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            reject
              ? { error: "Builder temporarily unavailable" }
              : { ok: true, commandId: `cmd-${++serial}`, runId: `run-${serial}` },
          ),
        });
      } else if (pathname.startsWith("/api/control/commands/")) {
        if (pathname.endsWith("cmd-2"))
          await new Promise<void>((resolve) => {
            holdSecond = resolve;
          });
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            terminal: pathname.endsWith("cmd-1") && completed,
            tone: pathname.endsWith("cmd-1") && completed ? "positive" : "neutral",
            label:
              pathname.endsWith("cmd-1") && completed
                ? "First task completed"
                : "Waiting for the builder",
          }),
        });
      } else if (pathname.startsWith("/api/")) {
        await route.fulfill({ contentType: "application/json", body: "{}" });
      } else {
        await route.fulfill({
          contentType: "text/html",
          body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}html,body{margin:0;font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
        });
      }
    });
    await page.goto("http://idle.fixture/terminal");
    await page.evaluate(() =>
      Object.assign(window, { process: { env: { NODE_ENV: "production" } } }),
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    assert.deepEqual(errors, [], "the actual component bundle loads");
    const mount = async (key: string, live = false) => {
      await page.evaluate(
        ({ key, live }) =>
          (window as unknown as { mount: (key: string, live: boolean) => void }).mount(key, live),
        { key, live },
      );
      // Wait for THIS mount's box, not any box. root.render commits in a later
      // task, and the previous mount's textarea already satisfied a bare
      // "textarea" wait: on a slow runner the next fill or file landed in the
      // old tree, the remount then discarded it, and the step waited 30s for
      // an answer that could not come (CI, 2026-11-11: 40s runs ending in a
      // TimeoutError, against 8s when green).
      await page.locator(`[data-mount="${key}"] textarea`).waitFor();
    };
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await mount(`width-${width}`);
      assert.equal(await page.locator("textarea").count(), 1, "one place to type");
      assert.ok(await page.getByText("Your task will wait", { exact: false }).isVisible());
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        font: parseFloat(getComputedStyle(document.querySelector("textarea")!).fontSize),
        send: (() => {
          const r = document.querySelector(".ck-send")!.getBoundingClientRect();
          return { width: r.width, height: r.height, bottom: r.bottom };
        })(),
      }));
      assert.equal(layout.overflow, false, `${width}px: no horizontal scroll`);
      assert.ok(layout.font >= 16, `${width}px: readable input`);
      assert.ok(layout.send.width >= 44 && layout.send.height >= 44, `${width}px: send target`);
      assert.ok(layout.send.bottom <= 844, `${width}px: send stays in view`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await mount("failed-send");
    const input = page.locator("textarea");
    await input.fill("Change the heading");
    await input.press("Enter");
    await page.getByText("Builder temporarily unavailable", { exact: false }).waitFor();
    assert.equal(await input.inputValue(), "Change the heading", "failed send retains the draft");
    fs.mkdirSync(".tmp/idle-session", { recursive: true });
    await page.screenshot({ path: ".tmp/idle-session/390-failed-send.png" });
    reject = false;
    await input.press("Enter");
    await page.getByText("Waiting for the builder", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "", "accepted task clears draft");
    assert.equal(posts.at(-1)?.path, "/api/control/tab-inject");
    assert.equal(posts.at(-1)?.body.tab, "my-project");
    await page.screenshot({ path: ".tmp/idle-session/390-queued.png" });
    completed = true;
    await page.getByText("First task completed", { exact: true }).waitFor();
    await input.fill("Change the footer too");
    await input.press("Enter");
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
    // A slow first poll must not borrow the last task's successful outcome or
    // clear the new task's status using the old task's completion timer.
    await page.waitForTimeout(4500);
    assert.equal(await page.getByText("First task completed", { exact: true }).count(), 0);
    assert.ok(await page.getByText("Sent as a task", { exact: false }).isVisible());
    assert.ok(holdSecond, "new task polled independently");
    holdSecond!();
    await page.getByText("Waiting for the builder", { exact: true }).waitFor();

    await mount("idle-command");
    const before = posts.length;
    await input.fill("/model test-choice");
    await input.press("Enter");
    await page.getByText("No session is running yet", { exact: false }).waitFor();
    assert.equal(await input.inputValue(), "/model test-choice");
    assert.equal(posts.length, before, "idle CLI command is not queued as a task");
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { written: string[] }).written),
      [],
    );

    await mount("idle-attachment");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "brief.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Change the page heading"),
      });
    await page.getByText("brief.txt", { exact: false }).first().waitFor();
    await input.fill("Use the attached brief");
    await input.press("Enter");
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
    const attachmentPost = posts.at(-1)!;
    assert.equal(
      attachmentPost.path,
      "/api/control/tab-inject",
      "cold attachments use startup, not live inject",
    );
    assert.equal((attachmentPost.body.attachments as { name: string }[])[0].name, "brief.txt");

    await mount("live-session", true);
    await input.fill("Keep working");
    await input.press("Enter");
    await page.waitForFunction(
      () => (window as unknown as { written: string[] }).written.length > 0,
    );
    assert.ok(
      (await page.evaluate(() => (window as unknown as { written: string[] }).written))
        .join("")
        .includes("Keep working"),
    );
    assert.deepEqual(errors, []);
    console.log(
      "✓ Idle composer: 320/390/1440, retryable drafts, queued/start status, independent tasks, commands and attachments",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
