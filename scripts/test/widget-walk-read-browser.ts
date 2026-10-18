/**
 * The owner's walk through Petvity, 2026-10-18, replayed in a real browser:
 * four pages, talking throughout, a coffee said to someone in the room. The
 * card must say what Loki heard, lead with what was asked, leave the asides
 * out, keep the words as spoken one tap away, and offer the button that
 * answers what was asked — Ask for a question (about the whole walk), Save
 * or Fix it now for a change. Words edited before the read arrives are kept.
 *
 * Run: npx tsx scripts/test/widget-walk-read-browser.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { PALETTE } from "../../src/lib/palette";

const PAGES = [
  { path: "/de", h1: "Dein Tier sendet ein Signal. Jetzt kannst du es lesen." },
  { path: "/de/features", h1: "Jede Funktion, die dein Tier wirklich braucht" },
  { path: "/portal/dashboard", h1: "What would you like to do?" },
  { path: "/portal/settings", h1: "Your data" },
];
const SAID = [
  { start: 0.2, text: "I think the design is inconsistent. Here's my homepage, design is one." },
  { start: 1.9, text: "We will actually log in." },
  { start: 3.6, text: "No, no, I'm just making a coffee." },
  {
    start: 5.3,
    text: "In general, I would like you to look at all these things and let me know what you think.",
  },
];
const QUESTION = {
  ask: "Look at the design of the home page, Features, the dashboard and Settings, say where it is inconsistent, and tell me what you think.",
  kind: "question",
  asides: ["No, no, I'm just making a coffee.", "We will actually log in."],
};
const CHANGE = {
  ask: "Make the design consistent across the home page, Features, the dashboard and Settings.",
  kind: "change",
  asides: ["No, no, I'm just making a coffee."],
};

const site = (path: string) => {
  const nav = PAGES.map(
    (p, i) => `<a class="go" data-i="${i}" href="${p.path}">${p.path}</a>`,
  ).join(" ");
  const first = PAGES.find((p) => p.path === path) ?? PAGES[0];
  return `<!doctype html><html lang="de"><head><title>Petvity</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:18px system-ui;margin:24px"><nav>${nav}</nav><main><h1 id="title">${first.h1}</h1><p style="height:1400px">Content.</p></main><script>
const pages = ${JSON.stringify(PAGES)};
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.go"); if (!a) return; e.preventDefault();
  const p = pages[Number(a.dataset.i)]; history.pushState({}, "", p.path);
  document.getElementById("title").textContent = p.h1; scrollTo(0, 0);
});
</script><script src="http://host.fixture/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`;
};

async function walkAndTalk(page: Page) {
  const host = page.locator("#loki-feedback-host");
  await page
    .getByRole("button", {
      name: "Talk to Loki — you can scroll the page while you speak",
      exact: true,
    })
    .click();
  await page.getByText("Recording 0:00", { exact: true }).waitFor();
  for (let i = 1; i < PAGES.length; i++) {
    await page.waitForTimeout(1700);
    await page.locator(`a.go[data-i="${i}"]`).click();
    await page.evaluate(() => scrollBy(0, 40));
  }
  await page.waitForTimeout(1500);
  await host.locator(".browse-voice").getByRole("button", { name: "Done", exact: true }).click();
}

async function main() {
  const bundle = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    write: false,
    format: "iife",
  });
  const browser = await chromium.launch({ headless: true });
  const out = ".tmp/widget-walk-read";
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const scenario of ["question", "change", "edited"] as const) {
      const width = scenario === "change" ? 320 : 390;
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        colorScheme: scenario === "change" ? "dark" : "light",
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const posted: Array<Record<string, unknown>> = [];
      const advised: Array<Record<string, unknown>> = [];
      const understood: Array<Record<string, unknown>> = [];
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
          return json({ text: SAID.map((s) => s.text).join(" "), segments: SAID });
        if (url.pathname === "/api/widget/understand") {
          understood.push(route.request().postDataJSON());
          // Slow enough that a person can start editing before it lands.
          await new Promise((r) => setTimeout(r, scenario === "edited" ? 2500 : 600));
          return json({ ok: true, read: scenario === "change" ? CHANGE : QUESTION });
        }
        if (url.pathname === "/api/widget/owner/changes")
          return json({ owner: true, changes: [], known: [], visitors: 0 });
        if (url.pathname === "/api/widget/advise") {
          const body = route.request().postDataJSON();
          if (!body.read) advised.push(body);
          return json({
            ok: true,
            reply: body.read ? "" : "The cards and headings differ between the pages.",
            changes: [],
          });
        }
        if (url.pathname === "/api/feedback") {
          posted.push(route.request().postDataJSON());
          return json({
            ok: true,
            owner: true,
            savedOnly: true,
            building: false,
            buildNote: "Saved.",
          });
        }
        return route.fulfill({ contentType: "text/html", body: site(url.pathname) });
      });
      await page.goto("http://host.fixture/de#loki-owner=test-owner");
      await page.waitForFunction(
        () => (window as unknown as { Loki?: { ready: boolean } }).Loki?.ready,
      );
      await page.evaluate(() =>
        (window as unknown as { Loki: { report(input: object): void } }).Loki.report({}),
      );
      const host = page.locator("#loki-feedback-host");
      await walkAndTalk(page);

      // "Did it hear me?" — answered first, with how long and where.
      const title = host.locator(".voice-note .changes-title");
      await title.waitFor();
      assert.match(await title.innerText(), /^Loki heard you · 0:0\d across 4 pages$/);
      const box = host.locator(".voice-note textarea");

      if (scenario === "edited") {
        // The person starts fixing the words before Loki's read is back.
        await host.getByText("Loki is reading what you said…").waitFor();
        await box.fill("Only the dashboard cards look different. Make them match the home page.");
        await host
          .getByText("Loki is reading what you said…")
          .waitFor({ state: "detached", timeout: 8000 });
        assert.equal(
          await box.inputValue(),
          "Only the dashboard cards look different. Make them match the home page.",
          "words the person edited are never replaced by Loki's read",
        );
        assert.equal(await host.locator(".said-exact").count(), 0);
        assert.deepEqual(errors, []);
        await page.close();
        console.log("Walk read: words edited before the read arrives are kept");
        continue;
      }

      await host.getByText(/^Loki understood/).waitFor({ timeout: 8000 });
      const read = scenario === "change" ? CHANGE : QUESTION;
      assert.equal(await box.inputValue(), read.ask, "the box leads with what was asked");
      assert.equal(understood.length, 1, "read once");
      assert.match(
        String(understood[0].note),
        /On \/portal\/settings — “Your data”/,
        "Loki reads the note as aligned",
      );
      assert.equal(
        (understood[0].moments as unknown[]).length >= 4,
        true,
        "with the walk beside it",
      );
      const leftOut = await host.locator(".voice-note .diag", { hasText: "Left out" }).innerText();
      assert.match(leftOut, /making a coffee/, "the aside is named, not hidden");
      // The words as spoken, one tap away.
      await host.locator(".said-exact summary").click();
      assert.match(
        await host.locator(".said-words").innerText(),
        /On \/de — “Dein Tier sendet ein Signal/,
      );
      assert.match(await host.locator(".said-exact").innerText(), /Loki noted what was on screen/);
      // The card is in view from its top, not found by scrolling.
      const inView = await host.locator(".voice-note").evaluate((card) => {
        const log = card.parentElement!;
        return card.getBoundingClientRect().top - log.getBoundingClientRect().top;
      });
      assert(inView >= -2 && inView < 200, `the card's top is in view (${inView}px)`);
      await page.screenshot({ path: `${out}/${width}-${scenario}.png` });
      const first = (await host.locator(".sendcard-actions button").first().innerText()).trim();

      if (scenario === "question") {
        assert.equal(first, "Ask Loki", "a question is answered by Ask");
        assert.equal(
          await host.getByRole("button", { name: "Fix it now", exact: true }).count(),
          0,
          "no build for a question",
        );
        await host.getByRole("button", { name: "Ask Loki", exact: true }).click();
        await host.getByText("The cards and headings differ between the pages.").waitFor();
        assert.equal(advised.length, 1);
        assert.equal(advised[0].question, QUESTION.ask);
        const session = String(advised[0].session);
        for (const p of PAGES) assert.ok(session.includes(p.path), `Ask looks at ${p.path}`);
        assert.match(session, /said: In general, I would like you to look at all these things/);
        assert.equal(posted.length, 0, "asking files nothing");
        await page.screenshot({ path: `${out}/${width}-question-answered.png` });
      } else {
        assert.equal(first, "Save", "the owner's change leads with Save");
        assert.equal(
          await host.getByRole("button", { name: "Fix it now", exact: true }).count(),
          1,
        );
        // Back to the words as spoken, and on to Loki's read again by Save.
        await host.getByRole("button", { name: "Use my exact words instead", exact: true }).click();
        assert.match(await box.inputValue(), /^On \/de — /);
        await box.fill(CHANGE.ask);
        await host.getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForFunction(() =>
          document
            .querySelector("#loki-feedback-host")
            ?.shadowRoot?.textContent?.includes("Saved."),
        );
        assert.equal(posted.length, 1);
        assert.equal(posted[0].suggestion, CHANGE.ask, "what is saved is what was asked");
        const moments = posted[0].moments as Array<{ page: string; said?: string }>;
        assert.ok(
          moments.some((m) => m.said?.includes("look at all these things")),
          "the words as spoken still travel with it, under the part they were said on",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `Walk read ${scenario} at ${width}px: heard, understood, asides left out, the right first button`,
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
