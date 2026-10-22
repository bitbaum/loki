/**
 * Sessions, as a phone shows it (shell/SessionsDrawer): what is open now in
 * words that say what a tap gives you, then every other project one tap from
 * its session — no colour code, no codes, no ages that are not about work.
 *
 * It was 42 rows, each with one of four coloured dots and one of six codes
 * ("ready", "offline", "open", "closed", "working", "—"), the age of a
 * database row, and a git-branch icon (owner, 2026-10-19: "what exactly do
 * you mean by sessions? What will happen when I click on AOZ Housing? …
 * super useless").
 *
 * Run: npx tsx scripts/test/sessions-drawer-browser.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import tailwind from "@tailwindcss/postcss";

const DAY = 86_400_000;
const now = Date.now();
const snapshot = {
  generatedAt: new Date(now).toISOString(),
  projects: [
    {
      id: "1",
      name: "Bitbaum",
      tab: "Bitbaum",
      session: { open: true, status: "working", line: "Working on Fix the contact form" },
    },
    {
      id: "2",
      name: "center-com",
      tab: "center-com",
      session: { open: true, status: "finished", line: "Finished — your turn" },
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      name: i === 0 ? "aoz-housing" : `project-${i}`,
      tab: null,
      session: {
        open: false,
        lastWorkedAt: i % 3 === 0 ? null : new Date(now - (i + 1) * DAY).toISOString(),
      },
    })),
  ],
};

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
        import{SessionsDrawer}from'./src/components/shell/SessionsDrawer';
        createRoot(document.getElementById('app')).render(<SessionsDrawer open onClose={()=>{window.closed=true}}/>);`,
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
              "export const usePathname=()=>'/control';export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){}});export const useSearchParams=()=>new URLSearchParams();",
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
    console.log("↷ sessions-drawer skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) =>
      r.fulfill(
        r.request().url().includes("/api/sessions/snapshot")
          ? { contentType: "application/json", body: JSON.stringify(snapshot) }
          : {
              contentType: "text/html",
              body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><body class="bg-surface-page text-text-primary"><div id="app"></div></body>`,
            },
      ),
    );
    await page.goto("http://sessions.fixture/control");
    await page.evaluate(() =>
      Object.assign(window, { process: { env: { NODE_ENV: "production" } } }),
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const dialog = page.getByRole("dialog", { name: "Sessions" });
    await dialog.getByText("Bitbaum").waitFor();

    // Named once, with no sentence under the name (design reset rule 2), and
    // headings in sentence case — not "42 PROJECTS".
    assert.equal(await dialog.locator("#sessions-title").textContent(), "Sessions");
    assert.equal(await dialog.locator(".ui-sessions-head p").count(), 0, "no subtitle");
    assert.equal(await dialog.getByRole("heading", { name: "Open now", exact: true }).count(), 1);

    // Open now: only the open ones, each in words that say what a tap gives.
    // Each is a row (ListRow): the link is its title, the words its one line.
    const openSection = dialog.locator("section", { hasText: "Open now" });
    const openList = openSection.getByRole("link");
    const openRows = openSection.locator("li");
    assert.equal(await openList.count(), 2, "only open sessions are under Open now");
    assert.match((await openRows.nth(0).textContent()) ?? "", /Working on Fix the contact form/);
    assert.match((await openRows.nth(1).textContent()) ?? "", /Finished — your turn/);
    assert.equal(
      await openList.nth(0).getAttribute("href"),
      "/terminal?tab=Bitbaum",
      "an open session opens itself",
    );

    // The rest: plain rows, eight then "Show all", a tap starts the project's
    // own session (its Resume on the Sessions page).
    const others = dialog.locator("section", { hasText: "Start another project" });
    assert.equal(await others.getByRole("link").count(), 8);
    const aoz = others.getByRole("link", { name: /Aoz housing/ });
    assert.equal(await aoz.getAttribute("href"), "/terminal?project=aoz-housing");
    assert.match(
      (await others
        .locator("li", { has: page.getByRole("link", { name: /Aoz housing/ }) })
        .textContent()) ?? "",
      /Not started yet/,
    );
    assert.match(
      (await others
        .locator("li", { has: page.getByRole("link", { name: /Project 1\b/ }) })
        .textContent()) ?? "",
      /Last worked 2 days ago|Last worked 2d ago/,
    );

    // Words, never codes; one colour at most (the working pulse); no icons
    // that need a legend.
    const text = (await dialog.textContent()) ?? "";
    for (const code of ["offline", "ready ·", " · —", "PROJECTS"]) {
      assert.ok(!text.includes(code), `no code "${code}" in the list`);
    }
    assert.equal(await dialog.locator(".ui-term-live-dot").count(), 1, "one dot: the working one");
    assert.equal(await dialog.locator("svg.lucide-git-branch").count(), 0, "no branch icon");

    // Even rows, the full width, nothing sideways.
    const heights = await dialog
      .locator(".ui-listrow")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    for (const h of heights) assert.ok(h >= 56 && h <= 72, `rows are 56–72px (got ${h})`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    fs.mkdirSync(".tmp/sessions-drawer", { recursive: true });
    await page.screenshot({ path: ".tmp/sessions-drawer/drawer-390.png", fullPage: true });

    // Find a project, and show all.
    await dialog.getByRole("searchbox", { name: "Find a project" }).fill("aoz");
    assert.equal(await others.getByRole("link").count(), 1);
    await dialog.getByRole("searchbox", { name: "Find a project" }).fill("");
    await others.getByRole("button", { name: "Show all 12" }).click();
    assert.equal(await others.getByRole("link").count(), 12);

    assert.deepEqual(errors, []);
    console.log("✓ sessions-drawer: open now in words, the rest one tap from their session");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("✗ sessions-drawer:", e instanceof Error ? e.message : e);
  process.exit(1);
});
