/**
 * The owner's panel on a phone, as the owner saw it on Loki's own site
 * (2026-10-18): a brand row, the page name and "Watching · 4 to look at · 11
 * needs you" stacked above the thread, and with the keyboard up the thread was
 * a one-pixel sliver — Loki's pages SHRINK for the keyboard
 * (interactive-widget=resizes-content), which the keyboard-inset check never
 * saw, so the sheet kept 68% of a viewport already halved.
 *
 * Holds: the status line is the header (one row, ✕ at its end, one number of
 * one named thing); typing fills what is visible, the thread keeps real room
 * and Send stays on screen; a phone bottom bar that asks for the tab gets the
 * edge tab, not the pill over the page.
 *
 * Run: npx tsx scripts/test/widget-owner-phone-browser.ts
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PALETTE } from "../../src/lib/palette";

const changes = Array.from({ length: 14 }, (_, i) => ({
  id: `c${i}`,
  text: i % 2 ? "The header overlaps on phones" : "Pricing button is hard to find",
  at: new Date(Date.now() - i * 3_600_000).toISOString(),
  label: i < 11 ? "Needs you" : "Live",
  tone: i < 11 ? "warning" : "positive",
  detail: "",
  live: i >= 11,
  settled: i >= 11,
  href: null,
  action: null,
  // The server marks what waits on the owner (owner-view.ts); the line counts it.
  needsYou: i < 11,
}));

async function main() {
  const bundle = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    write: false,
    format: "iife",
  });
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ owner phone panel skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript({ content: "globalThis.__name = (t) => t;" });
      await page.route("http://host.fixture/**", async (route) => {
        const url = new URL(route.request().url());
        const json = (b: unknown) =>
          route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
        if (url.pathname === "/widget.js")
          return route.fulfill({
            contentType: "text/javascript",
            body: bundle.outputFiles[0].text,
          });
        if (url.pathname === "/api/widget-boot")
          return json({
            active: true,
            theme: PALETTE.widget,
            themes: PALETTE.widgetThemes,
            placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
          });
        if (url.pathname === "/api/widget/owner/changes")
          return json({ owner: true, changes, known: [], visitors: 0 });
        if (url.pathname.startsWith("/api/")) return json({ ok: true, reply: "", changes: [] });
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Control — Loki</title>
            <meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content"></head>
            <body style="font:16px system-ui;margin:16px"><h1>Control</h1>
            ${"<p>Done recently — See the conversation</p>".repeat(30)}
            <nav data-fc-place="tab" style="position:fixed;left:8px;right:8px;bottom:8px;height:64px;display:flex;justify-content:space-around;align-items:center;background:#fff"><a href="#">Today</a><a href="#">Loki</a><a href="#">Control</a><a href="#">Menu</a></nav>
            <script src="http://host.fixture/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`,
        });
      });
      await page.goto("http://host.fixture/control#loki-owner=test-owner");
      await page.waitForFunction(
        () => (window as unknown as { Loki?: { ready: boolean } }).Loki?.ready,
      );
      const host = page.locator("#loki-feedback-host");
      const panel = host.locator(".panel");
      await panel.waitFor();
      // Wait for the state, not a clock: CI runs this beside hundreds of
      // other tests on two cores, where the changes fetch lands late.
      await page.waitForFunction(
        () =>
          /changes need you/.test(
            document
              .getElementById("loki-feedback-host")!
              .shadowRoot!.querySelector(".thoughts-sum")?.textContent ?? "",
          ),
        null,
        { timeout: 20_000 },
      );

      // ONE row of chrome: the status line is the header and ends with ✕.
      assert.equal(await host.locator(".hdr").isVisible(), false, `${width}: no brand/page row`);
      assert.equal(
        await host.locator(".thoughts-head [aria-label='Close']").count(),
        1,
        `${width}: close sits on the status line`,
      );
      assert.equal(
        (await host.locator(".thoughts-sum").innerText()).replace(/\s+/g, " ").trim(),
        "Watching · 11 changes need you",
        `${width}: one number of one named thing`,
      );
      const sum = await host.locator(".thoughts-sum").evaluate((el) => ({
        clipped: el.scrollHeight > el.clientHeight + 1,
      }));
      assert.equal(sum.clipped, false, `${width}: the status line is not cut off`);

      // Typing on a page that shrinks for the keyboard.
      await host.locator("textarea").first().focus();
      await page.setViewportSize({ width, height: 430 });
      await page.waitForFunction(
        () =>
          document
            .getElementById("loki-feedback-host")!
            .shadowRoot!.querySelector(".panel")
            ?.classList.contains("kb") &&
          (
            document
              .getElementById("loki-feedback-host")!
              .shadowRoot!.querySelector(".panel") as HTMLElement
          ).getBoundingClientRect().bottom <= window.innerHeight,
        null,
        { timeout: 20_000 },
      );
      const typing = await panel.evaluate((p) => {
        const r = p.getBoundingClientRect();
        const log = p.querySelector(".chatlog") as HTMLElement | null;
        const sends = [...p.querySelectorAll("button")]
          .filter((b) => /^(Ask|Fix it)$/.test((b.textContent ?? "").trim()))
          .map((b) => b.getBoundingClientRect().bottom);
        return {
          kb: p.classList.contains("kb"),
          top: r.top,
          bottom: r.bottom,
          log: log ? log.getBoundingClientRect().height : 0,
          logContent: log ? log.scrollHeight : 0,
          sends,
        };
      });
      assert.ok(typing.kb, `${width}: a focused box is the typing state`);
      assert.ok(
        typing.top >= 0 && typing.bottom <= 430,
        `${width}: the whole sheet is above the keyboard (${typing.top}–${typing.bottom})`,
      );
      // The thread is as tall as what it holds, up to the room there is: it
      // must show all of it, or at least 60px of it — never a sliver.
      assert.ok(
        typing.log >= Math.min(60, typing.logContent) - 1,
        `${width}: the thread keeps real room (${typing.log}px of ${typing.logContent}px)`,
      );
      assert.ok(typing.sends.length > 0, `${width}: Send is there`);
      for (const b of typing.sends) assert.ok(b <= 430, `${width}: Send stays on screen (${b})`);
      console.log(
        `  ${width}px typing: thread ${Math.round(typing.log)} of ${typing.logContent}px`,
      );

      // Android's back key drops the keyboard but leaves focus in the box:
      // the extras ("This page", Point to area) come back with the room.
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(
        () =>
          !document
            .getElementById("loki-feedback-host")!
            .shadowRoot!.querySelector(".panel")
            ?.classList.contains("kb"),
        null,
        { timeout: 20_000 },
      );
      assert.equal(
        await host.locator(".ctxbar").isVisible(),
        true,
        `${width}: keyboard down, Point to area is back`,
      );

      // Closed, the launcher is the edge tab the bottom bar asked for.
      await host.locator("[aria-label='Close']").first().click();
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(
        () =>
          document
            .getElementById("loki-feedback-host")!
            .shadowRoot!.querySelector(".fab")
            ?.classList.contains("tab"),
        null,
        { timeout: 20_000 },
      );
      assert.equal(
        await host.locator(".fab").evaluate((el) => el.classList.contains("tab")),
        true,
        `${width}: the phone bar's data-fc-place="tab" makes the launcher the edge tab`,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("✓ widget owner phone: one-row header, room to type, the tab above the bar");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  // One line first: the unit runner shows only the tail of a failure.
  console.error(e instanceof Error ? e.stack : e);
  console.error(`✗ widget owner phone: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
