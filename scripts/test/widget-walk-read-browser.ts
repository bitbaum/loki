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
// The question comes back in the read's first shape (one ask) — an answer
// from before the list still reads. The change comes back as a list.
const CHANGE = {
  items: [
    {
      text: "Make the cards and headings match across the home page, Features and the dashboard.",
      kind: "change",
      where: "Home page, Features, dashboard",
      parts: [0, 1, 2],
    },
    {
      text: "Put Download my data in its own section.",
      kind: "change",
      where: "Settings",
      parts: [3],
    },
    { text: "Is the dashboard greeting still needed?", kind: "question", where: null, parts: [2] },
  ],
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
      const box = host.locator(".voice-note textarea.chatinput");

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

      await host.getByText(/^Here is what Loki heard/).waitFor({ timeout: 8000 });
      const lines = scenario === "change" ? CHANGE.items.map((i) => i.text) : [QUESTION.ask];
      assert.deepEqual(
        await host
          .locator(".heard-text")
          .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value)),
        lines,
        "the card lists what was heard, one thing per line",
      );
      assert.equal(await box.isVisible(), false, "the list is the note");
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
      // The card is in view from its top, not found by scrolling.
      const inView = await host.locator(".voice-note").evaluate((card) => {
        const log = card.parentElement!;
        return card.getBoundingClientRect().top - log.getBoundingClientRect().top;
      });
      assert(inView >= -2 && inView < 200, `the card's top is in view (${inView}px)`);
      // The words as spoken, one tap away.
      await host.locator(".said-exact summary").click();
      assert.match(
        await host.locator(".said-words").innerText(),
        /On \/de — “Dein Tier sendet ein Signal/,
      );
      assert.match(await host.locator(".said-exact").innerText(), /Loki noted what was on screen/);
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
        assert.equal(first, "Save 2 changes", "the owner's changes lead with Save, counted");
        assert.equal(
          await host.getByRole("button", { name: "Fix them now", exact: true }).count(),
          1,
        );
        assert.equal(
          await host.getByRole("button", { name: "Ask the question", exact: true }).count(),
          1,
        );
        assert.match(
          await host.locator(".heard-where").first().innerText(),
          /^Change · Home page, Features, dashboard$/,
        );
        // Each word is the person's to change before it is saved.
        await host.locator(".heard-text").nth(1).fill("Give Download my data its own section.");
        await host.getByRole("button", { name: "Save 2 changes", exact: true }).click();
        await page.waitForFunction(() =>
          document
            .querySelector("#loki-feedback-host")
            ?.shadowRoot?.textContent?.includes("Saved."),
        );
        assert.equal(posted.length, 2, "each change is saved on its own");
        assert.equal(
          posted[0].suggestion,
          `Home page, Features, dashboard: ${CHANGE.items[0].text}`,
          "saved as heard, with where",
        );
        assert.equal(posted[1].suggestion, "Settings: Give Download my data its own section.");
        const sent = understood[0].moments as Array<{ page: string }>;
        const second = posted[1].moments as Array<{ page: string; said?: string }>;
        assert.deepEqual(
          second.map((m) => m.page),
          [sent[3].page],
          "a change carries the moments it came from",
        );
        assert.equal(posted[1].page, sent[3].page, "and is filed on the page it was said on");
        // The question stays on the card for Ask; the words as spoken, one tap away.
        assert.deepEqual(
          await host
            .locator(".heard-text")
            .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value)),
          [CHANGE.items[2].text],
        );
        await host.locator(".said-exact summary").click();
        await host.getByRole("button", { name: "Use my exact words instead", exact: true }).click();
        assert.match(await box.inputValue(), /^On \/de — /);
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
