import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PALETTE } from "../../src/lib/palette";

async function main() {
  const bundle = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    write: false,
    format: "iife",
    minify: false,
  });
  const transcript = "The pricing action is difficult to find. ".repeat(45).slice(0, 1900).trim();
  const browser = await chromium.launch({ headless: true });
  const out = ".tmp/widget-browse-voice";
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const owner of [true, false]) {
      const page = await browser.newPage({ viewport: { width: owner ? 320 : 390, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const posted: Array<Record<string, unknown>> = [];
      await page.addInitScript({ content: "globalThis.__name = (target) => target;" });
      await page.addInitScript(() => {
        class Recorder extends EventTarget {
          state = "inactive";
          mimeType = "audio/webm";
          static isTypeSupported() {
            return true;
          }
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            queueMicrotask(() => {
              const event = new Event("dataavailable");
              Object.defineProperty(event, "data", {
                value: new Blob(["x".repeat(2000)], { type: "audio/webm" }),
              });
              this.dispatchEvent(event);
              this.dispatchEvent(new Event("stop"));
            });
          }
        }
        Object.defineProperty(window, "MediaRecorder", { value: Recorder });
        Object.defineProperty(navigator, "mediaDevices", {
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
        });
        Object.defineProperty(document, "featurePolicy", { value: { allowsFeature: () => true } });
        (window as unknown as { clicks: number }).clicks = 0;
      });
      await page.route("http://host.fixture/**", async (route) => {
        const url = new URL(route.request().url());
        const json = (body: unknown) =>
          route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === "/widget.js")
          return route.fulfill({
            contentType: "text/javascript",
            body: bundle.outputFiles[0].text,
          });
        if (url.pathname === "/api/widget-boot")
          return json({
            active: true,
            theme: PALETTE.widget,
            placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
          });
        if (url.pathname === "/api/widget/transcribe")
          return json({
            text: transcript,
          });
        if (url.pathname === "/api/widget/owner/changes")
          return json({ owner: true, changes: [], known: [], visitors: 0 });
        if (url.pathname === "/api/widget/advise")
          return json({ ok: true, reply: "", changes: [] });
        if (url.pathname === "/api/feedback") {
          posted.push(route.request().postDataJSON());
          return json({
            ok: true,
            owner,
            savedOnly: true,
            building: false,
            buildNote: "Saved for review. No fix has been started.",
            ...(owner
              ? { followUrl: "http://host.fixture/projects/project#feedback" }
              : { claimUrl: "http://host.fixture/claim-feedback?token=claim" }),
          });
        }
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><head><title>AoZ example</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:18px system-ui;margin:24px"><main><h1>Welcome</h1><button id="normal" style="padding:14px" onclick="window.clicks++">Browse services</button><input type="password" value="private-password"><section style="margin-top:800px"><h2>Pricing</h2><button id="price" style="padding:14px" onclick="window.clicks++">Choose this plan</button></section></main><script src="http://host.fixture/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`,
        });
      });
      await page.goto(
        `http://host.fixture/original?token=private${owner ? "#loki-owner=test-owner" : ""}`,
      );
      const host = page.locator("#loki-feedback-host");
      await page.waitForFunction(
        () => (window as unknown as { Loki?: { ready: boolean } }).Loki?.ready,
      );
      await page.evaluate(() =>
        (window as unknown as { Loki: { report(input: object): void } }).Loki.report({}),
      );
      const speak = page.getByRole("button", { name: "Speak while browsing", exact: true });
      await speak.waitFor({ state: "visible" });
      assert.equal((await speak.innerText()).trim(), "Speak", "The mic has a visible text label");
      const icon = await speak.locator("svg").boundingBox();
      assert(
        icon && icon.width >= 16 && icon.width <= 24 && icon.height >= 16 && icon.height <= 24,
        "The microphone icon has a readable rendered size",
      );
      const speakBox = await speak.boundingBox();
      assert(speakBox && speakBox.x >= 0 && speakBox.x + speakBox.width <= (owner ? 320 : 390));
      await page.screenshot({ path: `${out}/${owner ? 320 : 390}-entry.png` });
      await speak.click({ timeout: 5000 }).catch(async (error) => {
        console.error(
          "Voice header fixture",
          await page.evaluate(() => ({
            header: document
              .querySelector("#loki-feedback-host")
              ?.shadowRoot?.querySelector(".hdr-actions")?.outerHTML,
            microphone: !!navigator.mediaDevices?.getUserMedia,
            recorder: typeof MediaRecorder,
            policy: (
              document as unknown as { featurePolicy?: { allowsFeature(name: string): boolean } }
            ).featurePolicy?.allowsFeature("microphone"),
          })),
          errors,
        );
        throw error;
      });
      await page.getByText("Listening 0:00", { exact: true }).waitFor();
      assert.equal(await host.locator(".panel").count(), 0, "Recording leaves the site usable");
      await page.locator("#normal").click();
      assert.equal(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 1);
      await page.locator("#price").scrollIntoViewIfNeeded();
      await page
        .getByRole("button", { name: "Mark the part of the page you are talking about" })
        .click();
      await page.getByText("Marked “Pricing”", { exact: true }).waitFor();
      assert.equal(await host.locator(".pickbar").count(), 0, "Mark never opens a picker");
      assert(
        await host
          .locator(".browse-voice")
          .evaluate((el) => el.getBoundingClientRect().width <= innerWidth - 20),
      );
      await page.screenshot({ path: `${out}/${owner ? 320 : 390}-recording.png` });
      assert.equal(posted.length, 0, "Speaking never submits automatically");
      await host
        .locator(".browse-voice")
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await page.getByText("What you said", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Build it", exact: true }).count(),
        owner ? 1 : 0,
      );
      await page.reload();
      await page.waitForFunction(
        () => (window as unknown as { Loki?: { ready: boolean } }).Loki?.ready,
      );
      await page.evaluate(() =>
        (window as unknown as { Loki: { report(input: object): void } }).Loki.report({}),
      );
      await page.getByText("What you said", { exact: true }).waitFor();
      assert.equal(await host.locator(".sendcard textarea").inputValue(), transcript);
      assert.equal(await host.locator(".composer").isVisible(), false);
      assert.equal(await host.locator(".starters").isVisible(), false);
      await page.screenshot({ path: `${out}/${owner ? 320 : 390}-note.png` });
      await page.evaluate(() => {
        history.pushState({}, "", "/somewhere-else");
        window.scrollTo(0, 0);
      });
      await page
        .getByRole("button", {
          name: owner ? "Save note" : "Send to whoever builds this site",
          exact: true,
        })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#loki-feedback-host")
            ?.shadowRoot?.textContent?.includes("Saved for review") ||
          document
            .querySelector("#loki-feedback-host")
            ?.shadowRoot?.textContent?.includes("Thank you."),
      );
      assert.equal(posted.length, 1);
      assert.equal(posted[0].intent, "note");
      assert.equal(posted[0].page, "/original");
      assert.equal(posted[0].url, "http://host.fixture/original");
      assert.equal(
        String(posted[0].suggestion),
        transcript,
        "All transcribed words remain separate from context",
      );
      assert(JSON.stringify(posted[0]).includes("Pricing (marked)"), "what was marked travels");
      assert(!JSON.stringify(posted[0]).includes("private-password"));
      await page.getByRole("button", { name: "Speak while browsing", exact: true }).click();
      await host
        .locator(".browse-voice")
        .getByRole("button", { name: "Cancel this recording", exact: true })
        .click();
      assert.equal(await host.locator(".browse-voice").count(), 0);
      await page.locator("#normal").click();
      assert.equal(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 1);
      assert.equal(posted.length, 1, "Cancelling never files another note");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `Browse voice ${owner ? "owner 320px" : "visitor 390px"}: real clicks, Mark, editable note, frozen location and no automatic dispatch passed`,
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
