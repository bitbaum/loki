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
      const page = await browser.newPage({
        viewport: { width: owner ? 320 : 390, height: 844 },
        colorScheme: owner ? "dark" : "light",
      });
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
            themes: PALETTE.widgetThemes,
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
            buildNote:
              "It waits with your other saved notes — build them all from the Watching line on your site, or in Loki.",
            ...(owner
              ? { followUrl: "http://host.fixture/projects/project#feedback" }
              : { claimUrl: "http://host.fixture/claim-feedback?token=claim" }),
          });
        }
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><head><title>AoZ example</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:18px system-ui;margin:24px"><main><h1>Welcome</h1><button id="normal" style="padding:14px" onclick="window.clicks++">Browse services</button><input type="password" value="private-password"><section style="margin-top:800px"><h2>Pricing</h2><button id="price" style="padding:14px" onclick="window.clicks++">Choose this plan</button><p style="height:1600px">Every plan, in detail.</p></section></main><footer style="height:400px">© AoZ</footer><script src="http://host.fixture/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`,
        });
      });
      await page.goto(
        `http://host.fixture/original?token=private${owner ? "#loki-owner=test-owner" : ""}`,
      );
      const host = page.locator("#loki-feedback-host");
      await page.waitForFunction(
        () => (window as unknown as { Loki?: { ready: boolean } }).Loki?.ready,
      );
      // Talk without opening Loki: the owner's launcher has a microphone inside
      // it, and one tap starts recording with the panel still closed.
      const quick = host.locator(".fab-talk");
      if (owner) {
        // The owner arrives with the panel open; the microphone is for when it is not.
        await page.waitForTimeout(500);
        if (await host.locator(".panel").count()) await page.keyboard.press("Escape");
        await quick.waitFor({ state: "visible" });
        await page.screenshot({ path: `${out}/320-quick-talk.png` });
        const [mic, fab] = [await quick.boundingBox(), await host.locator(".fab").boundingBox()];
        assert(mic && fab, "both on screen");
        assert(
          mic.x >= fab.x - 0.5 &&
            mic.x + mic.width <= fab.x + fab.width + 0.5 &&
            mic.y >= fab.y - 0.5 &&
            mic.y + mic.height <= fab.y + fab.height + 0.5,
          "inside the launcher's own pill, never a second thing beside it",
        );
        assert(mic.width >= 44 && mic.height >= 44, "a thumb-sized target");
        await quick.click();
        await host.locator(".browse-voice").waitFor();
        assert.equal(await host.locator(".panel").count(), 0, "the panel stays closed");
        assert.equal(await quick.isVisible(), false, "the dock replaces it while recording");
        await host
          .locator(".browse-voice")
          .getByRole("button", { name: "Cancel this recording", exact: true })
          .click();
        await quick.waitFor({ state: "visible" });
      } else {
        await page.waitForTimeout(300);
        assert.equal(await quick.isVisible(), false, "a visitor's launcher stays quiet");
      }
      await page.evaluate(() =>
        (window as unknown as { Loki: { report(input: object): void } }).Loki.report({}),
      );
      assert.equal(await quick.isVisible(), false, "not beside an open panel");
      assert.equal(
        await host.getAttribute("data-lk-theme"),
        owner ? "dark" : "light",
        "The widget follows the selected Loki theme on this viewport",
      );
      const speak = page.getByRole("button", {
        name: "Talk to Loki — you can scroll the page while you speak",
        exact: true,
      });
      await speak.waitFor({ state: "visible" });
      assert.equal(
        (await speak.innerText()).trim(),
        "Talk",
        "The one microphone says what it does",
      );
      assert.equal(
        await host.locator(".mic").count(),
        1,
        "One microphone in the panel: talking while scrolling is also plain dictation",
      );
      const icon = await speak.locator("svg").boundingBox();
      assert(
        icon && icon.width >= 16 && icon.width <= 24 && icon.height >= 16 && icon.height <= 24,
        "The microphone icon has a readable rendered size",
      );
      const speakBox = await speak.boundingBox();
      assert(speakBox && speakBox.x >= 0 && speakBox.x + speakBox.width <= (owner ? 320 : 390));
      const panelBox = await host.locator(".panel").boundingBox();
      const actionsBox = await host.locator(".composer-actions").boundingBox();
      assert(
        panelBox && actionsBox && actionsBox.y + actionsBox.height <= panelBox.y + panelBox.height,
        "The composer actions stay inside the visible mobile panel",
      );
      await page.screenshot({ path: `${out}/${owner ? 320 : 390}-entry.png` });
      await speak.click({ timeout: 5000 }).catch(async (error) => {
        console.error(
          "Voice fixture",
          await page.evaluate(() => ({
            header: document
              .querySelector("#loki-feedback-host")
              ?.shadowRoot?.querySelector(".composer-actions")?.outerHTML,
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
      await page.getByText("Recording 0:00", { exact: true }).waitFor();
      assert.equal(await host.locator(".panel").count(), 0, "Recording leaves the site usable");
      // The whole screen says it is recording — a red edge that takes no taps.
      const frame = await host.locator(".bv-frame").evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { events: cs.pointerEvents, w: r.width, h: r.height, border: cs.borderTopWidth };
      });
      assert.equal(frame.events, "none", "the recording frame never takes a tap");
      assert(frame.w >= (owner ? 319 : 389) && frame.border === "3px", "it edges the whole screen");
      await page.locator("#normal").click();
      assert.equal(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 1);
      await page.locator("#price").scrollIntoViewIfNeeded();
      await page
        .getByRole("button", { name: "Mark the part of the page you are talking about" })
        .click();
      await page.getByText("Marked “Pricing”", { exact: true }).waitFor();
      assert.equal(await host.locator(".pickbar").count(), 0, "Mark never opens a picker");
      // Down to the footer: the Pricing heading has scrolled off the top, and
      // no heading is on screen. The person is still in Pricing — never "the
      // page's title" (found walking the live Petvity home page, 2026-10-17).
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(900);
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
      // The card answers "did it hear me?" first (widget/walk-read.ts). Loki's
      // read is not served here, so this is the card when the read fails: the
      // words as spoken, the buttons as before — never a dead end.
      await host.locator(".voice-note .changes-title", { hasText: /^Loki heard you/ }).waitFor();
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#loki-feedback-host")
            ?.shadowRoot?.textContent?.includes("Loki is reading what you said"),
      );
      assert.equal(
        await page.getByRole("button", { name: "Fix it now", exact: true }).count(),
        owner ? 1 : 0,
      );
      // Record now, build later: the owner's card leads with Save, a visitor's with Ask.
      assert.equal(
        (await host.locator(".sendcard-actions button").first().innerText()).trim(),
        owner ? "Save" : "Ask",
      );
      await page.reload();
      await page.waitForFunction(
        () => (window as unknown as { Loki?: { ready: boolean } }).Loki?.ready,
      );
      await page.evaluate(() =>
        (window as unknown as { Loki: { report(input: object): void } }).Loki.report({}),
      );
      await host.locator(".voice-note .changes-title", { hasText: /^Loki heard you/ }).waitFor();
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
          name: owner ? "Save" : "Save feedback",
          exact: true,
        })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#loki-feedback-host")
            ?.shadowRoot?.textContent?.includes("It waits with your other saved notes") ||
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
      // Said → seen: the walk travels as moments — the tap on the site's own
      // button by its label, the marked part, the scroll — never the password.
      const moments = posted[0].moments as Array<{
        label: string;
        marked?: boolean;
        scrollY?: number;
        tap?: { text: string; selector: string };
        said?: string;
      }>;
      assert(Array.isArray(moments) && moments.length >= 2, "the walk's moments travel");
      assert(
        moments.some((m) => m.tap?.text === "Browse services" && m.tap.selector === "#normal"),
        `a tap on the site is a moment with the control's label: ${JSON.stringify(moments)}`,
      );
      const pricing = moments.find((m) => m.label === "Pricing");
      assert(pricing?.marked, "Mark marks the part in view");
      assert(typeof pricing?.scrollY === "number" && pricing.scrollY > 0, "the scroll is kept");
      assert(
        !moments.some((m) => m.label === "AoZ example"),
        `deep in a section, the moment names the section, not the page title: ${JSON.stringify(moments)}`,
      );
      assert(
        pricing!.scrollY! > 1400,
        "scrolling on within Pricing moves that moment's view to where the person stopped",
      );
      assert.equal(
        moments[0].said,
        transcript.slice(0, 600),
        "without timings the words belong to the first part, capped by the contract",
      );
      assert(!JSON.stringify(posted[0]).includes("private-password"));
      await page
        .getByRole("button", {
          name: "Talk to Loki — you can scroll the page while you speak",
          exact: true,
        })
        .click();
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
