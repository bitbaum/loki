/**
 * Alerts on a phone, in the bell's panel and on /system: one thing to read
 * and one thing to do per row.
 *
 * The bell showed "WARNING" / "INFO" in capitals beside every title, the
 * whole description, a bordered "View" and a bare tick; /system put each alert
 * in a beige or red box holding its full text (owner, 2026-10-19: "a bunch of
 * text … some are red, some are green. Very bad design").
 *
 * The bell's sheet is ListRows since the design reset (2026-10): one grey
 * line per alert, the whole row the action, × to dismiss, and anything past
 * its relevance under "Earlier", uncounted (lib/alerts/relevance).
 *
 * Run: npx tsx scripts/test/alert-list-browser.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import tailwind from "@tailwindcss/postcss";

const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
const ALERTS = [
  {
    id: "a1",
    type: "runner_version_stale",
    severity: "warning",
    title: "Fleet Runner needs an update on one computer",
    description:
      "It is running an older version, so recent fixes are not on it yet. Install the latest from Download — on a .deb install, run the new installer yourself.\n\nlocal: 0.8.40 (published 0.8.46, 6 behind)\n\nAn old build does not fail outright.",
    actionUrl: "/download",
    createdAt: hourAgo,
  },
  {
    id: "a2",
    type: "studio_request",
    severity: "info",
    title: "New partner application",
    description:
      'Application: "George I built pretty much everything on this platform I\'m the one who could build bimbal and everything else on it and a few more words so that it wraps past two lines on a phone"',
    actionUrl: "/studio/requests/x",
    createdAt: hourAgo,
  },
  {
    id: "a3",
    type: "telemetry_stale",
    severity: "urgent",
    title: "Activity stopped recording one kind of event",
    description:
      "Activity, digests and run history are missing recent work, so they look calmer than things are.\n\nclaude_code_history — last row 131d ago (budget 48h).",
    actionUrl: "/system",
    createdAt: hourAgo,
  },
];

/** Nineteen days old and not urgent: /api/alerts marks it `earlier`
 *  (lib/alerts/relevance, tested in alert-relevance.ts), so the bell lists it
 *  under "Earlier". */
const OLD = {
  id: "a4",
  type: "studio_request",
  severity: "info",
  title: "Older partner application",
  description: "Application: an old one",
  actionUrl: "/studio/requests/y",
  createdAt: new Date(Date.now() - 19 * 86_400_000).toISOString(),
  earlier: true,
};

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
        import{NotificationPanel}from'./src/components/shell/NotificationPanel';
        import{AlertList}from'./src/components/alerts/AlertList';
        const root=createRoot(document.getElementById('app'));
        window.mount=(which)=>root.render(which==='bell'
          ?<NotificationPanel onClose={()=>{window.closed=true}}/>
          :<main className="app-page"><div className="ui-card-shell ui-card-padding"><div className="ui-alert-card-list"><AlertList alerts={window.alerts} onDismissed={id=>{window.dismissed=id}}/></div></div></main>);`,
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
              "export const usePathname=()=>'/system';export const useRouter=()=>({push(){},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();",
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
    console.log("↷ alert-list skipped: Chromium unavailable; CI runs it");
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
    const patched: string[] = [];
    await page.route("**/*", (r) => {
      const url = r.request().url();
      if (url.includes("/api/alerts/") && url.endsWith("/dismiss")) {
        patched.push(url);
        return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
      }
      if (url.endsWith("/api/alerts"))
        return r.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ alerts: [...ALERTS, OLD] }),
        });
      return r.fulfill({
        contentType: "text/html",
        body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><body class="bg-surface-page text-text-primary"><div id="app"></div></body>`,
      });
    });
    await page.goto("http://alerts.fixture/system");
    await page.evaluate(
      (a) => Object.assign(window, { alerts: a, process: { env: { NODE_ENV: "production" } } }),
      ALERTS,
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    fs.mkdirSync(".tmp/alerts", { recursive: true });
    const mount = (w: string) =>
      page.evaluate((x) => (window as unknown as { mount: (w: string) => void }).mount(x), w);

    // The bell: rows, one line each, the old one folded under "Earlier".
    await mount("bell");
    const sheet = page.locator(".ui-notification-body");
    await sheet.locator(".ui-listrow").first().waitFor();
    {
      const text = (await sheet.innerText()) ?? "";
      for (const word of ["WARNING", "INFO", "URGENT"]) {
        assert.ok(!text.includes(word), `bell: no "${word}" in capitals`);
      }
      assert.ok(!text.includes("budget 48h") && !text.includes("0.8.40"), "bell: details folded");
      const tall = await sheet
        .locator(".ui-listrow-secondary-text")
        .evaluateAll(
          (els) =>
            els.filter(
              (e) =>
                e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) + 1,
            ).length,
        );
      assert.equal(tall, 0, "bell: one grey line per alert");
      const now = await page
        .getByRole("list", { name: "Needs you" })
        .locator(".ui-listrow-title")
        .allTextContents();
      assert.equal(now.length, 3, "bell: the three fresh alerts need you");
      const earlier = await page
        .getByRole("list", { name: "Earlier notifications" })
        .locator(".ui-listrow-title")
        .allTextContents();
      assert.deepEqual(earlier, ["Older partner application"], "bell: the old one is Earlier");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
      await page.screenshot({ path: ".tmp/alerts/bell-390.png" });
      await page
        .getByRole("button", { name: "Dismiss: Fleet Runner needs an update on one computer" })
        .click();
      await page
        .getByText("Fleet Runner needs an update on one computer")
        .waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Clear all" }).click();
      await page.getByText("Older partner application").waitFor({ state: "detached" });
      assert.ok(
        patched.some((u) => u.includes("/a1/")),
        "bell: × dismissed it",
      );
      assert.ok(
        patched.some((u) => u.includes("/a4/")),
        "bell: Clear all cleared Earlier",
      );
      patched.length = 0;
    }

    for (const which of ["system"]) {
      await mount(which);
      await page.locator(".ui-alert-row").first().waitFor();
      const text = (await page.locator("body").innerText()) ?? "";
      for (const word of ["WARNING", "INFO", "URGENT"]) {
        assert.ok(!text.includes(word), `${which}: no "${word}" in capitals`);
      }
      // The technical record is folded away until asked for.
      assert.ok(!text.includes("budget 48h"), `${which}: details folded`);
      assert.ok(!text.includes("0.8.40"), `${which}: details folded`);
      // Each summary is at most two lines.
      const tall = await page.$$eval(
        ".ui-alert-summary",
        (els) =>
          els.filter(
            (e) =>
              e.getBoundingClientRect().height > 2 * parseFloat(getComputedStyle(e).lineHeight) + 1,
          ).length,
      );
      assert.equal(tall, 0, `${which}: every summary clamped to two lines`);
      // One action per row, named for where it goes — none to the page you are on.
      const actions = await page.$$eval(".ui-alert-row", (rows) =>
        rows.map((r) => [...r.querySelectorAll(".ui-alert-action")].map((a) => a.textContent)),
      );
      assert.deepEqual(
        actions,
        // The fixture page is /system, so the third (to /system) has none.
        [["Get the update"], ["Review"], []],
        `${which}: one named action per row`,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        390,
        `${which}: nothing scrolls sideways`,
      );
      await page.screenshot({ path: `.tmp/alerts/${which}-390.png` });
    }

    // Details opens the record in place; Dismiss is a word and it lands.
    const first = page.locator(".ui-alert-row").first();
    await first.getByRole("button", { name: "Details" }).click();
    await first.getByText("0.8.40", { exact: false }).waitFor();
    await page.screenshot({ path: ".tmp/alerts/system-details-390.png" });
    await first.getByRole("button", { name: "Dismiss" }).click();
    await page.waitForFunction(
      () => (window as unknown as { dismissed?: string }).dismissed === "a1",
    );
    assert.equal(patched.length, 1);
    assert.deepEqual(errors, []);
    console.log("✓ alert-list: bell rows with Earlier folded; /system calm rows, one named action");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("✗ alert-list:", e instanceof Error ? e.message : e);
  process.exit(1);
});
