// The widget's conversation drawn by the shared chat (widget/chat/, chatkit) —
// in a real browser, because every piece of it is a browser fact: the chunk
// loading beside widget.js, chatkit's styles inside a shadow root (their
// `:root` and rem would otherwise miss or follow the host), the composer's own
// Enter reaching it through the panel's key handling, and the widget's cards
// mounted in chatkit's slots.
//
// What it proves, each pinned below:
//   - `data-fc-chat="kit"` loads /widget-chat.js on first open and the panel
//     draws the conversation with chatkit; the vanilla thread steps aside;
//   - asking (Enter in chatkit's composer) reaches Loki, the answer lands with
//     its changes under it, and "Send to builder" opens the card that files it;
//   - the scope menu sits in the composer; the thread is bounded, not the page;
//   - the host page's own hotkeys never see what is typed;
//   - a chunk that cannot load leaves the panel's own conversation working;
//   - at phone width nothing overflows.
//
// Run: npx tsx scripts/test/widget-kit-browser.ts (needs Chromium; CI has it).
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { PALETTE } from "../../src/lib/palette";
import { buildWidgetChat } from "../build-widget-chat";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const ORIGIN = "http://host.fixture";
const page = (kit: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Farmhouse</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html { font-size: 10px; }</style></head><body>
<main><h1>Welcome to the farm</h1><button id="book">Submit</button></main>
<script>window.hostKeys = []; document.addEventListener("keydown", (e) => hostKeys.push(e.key));</script>
<script src="${ORIGIN}/widget.js" data-fc-project="fcw_fixture" ${kit ? 'data-fc-chat="kit"' : ""} async></script>
</body></html>`;

type Bundles = { js: string; chat: string };

async function open(
  browser: Browser,
  b: Bundles,
  o: { kit?: boolean; chunk?: boolean; width?: number; height?: number; visual?: boolean } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width: o.width ?? 1200, height: o.height ?? 800 },
  });
  const p = await ctx.newPage();
  const errors: string[] = [];
  const asked: { question: string }[] = [];
  const reports: { suggestion: string; contact?: string; screenshots?: string[] }[] = [];
  let chunkFetched = false;
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ body: JSON.stringify(body), contentType: "application/json" });
    if (url.pathname === "/widget.js")
      return route.fulfill({ body: b.js, contentType: "text/javascript" });
    if (url.pathname === "/widget-chat.js") {
      chunkFetched = true;
      if (o.chunk === false) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ body: b.chat, contentType: "text/javascript" });
    }
    if (url.pathname === "/api/widget-boot")
      return json({
        active: true,
        placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
        theme: PALETTE.widget,
        themes: PALETTE.widgetThemes,
      });
    if (url.pathname === "/api/widget/advise") {
      asked.push(JSON.parse(route.request().postData() ?? "{}") as { question: string });
      return json({
        ok: true,
        reply: o.visual
          ? "Here are your options.\n\n```chat_ui\n" +
            JSON.stringify({
              type: "choices",
              title: "What would help next?",
              options: [
                { label: "Compare alternatives", reply: "Please compare the alternatives" },
                { label: "Explain the recommendation", reply: "Please explain the recommendation" },
              ],
              submit: "Continue",
            }) +
            "\n```"
          : "The button says **Submit**, which does not tell a guest what happens.",
        changes: ["Change the button text from 'Submit' to 'Book your stay'"],
      });
    }
    if (url.pathname === "/api/feedback") {
      reports.push(JSON.parse(route.request().postData() ?? "{}") as (typeof reports)[0]);
      return json({ ok: true, claimUrl: "https://loki.test/claim-feedback/x" });
    }
    return route.fulfill({ body: page(o.kit ?? true), contentType: "text/html" });
  });
  await p.goto(`${ORIGIN}/`);
  await p.waitForTimeout(800);
  return {
    p,
    errors,
    asked,
    reports,
    chunkFetched: () => chunkFetched,
    close: () => ctx.close(),
  };
}

const root = "#loki-feedback-host";

async function main() {
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    if (process.env.CI) {
      console.error(`✗ Chromium is required under CI and could not launch: ${why}`);
      process.exit(1);
    }
    console.log(`↷ skipped: no Chromium on this machine (${why}). CI runs it.`);
    process.exit(0);
  }
  const main = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const chat = await buildWidgetChat({ write: false });
  const b: Bundles = { js: main.outputFiles[0].text, chat: chat.outputFiles![0].text };

  // ── Weight: the chat costs only those who open it ────────────────────────
  {
    const shipped = await build({
      entryPoints: ["widget/main.ts"],
      bundle: true,
      minify: true,
      format: "iife",
      write: false,
      logLevel: "silent",
    });
    const panel = shipped.outputFiles[0].text;
    ok(!panel.includes("ck-thread-inner"), "widget.js carries none of chatkit (it is the chunk's)");
    const kb = (t: string) => Math.round(gzipSync(t).length / 1024);
    // Measured 24 KB when it landed; the budget leaves room, not a blank cheque.
    ok(kb(b.chat) <= 32, `the chat chunk stays small (${kb(b.chat)} KB gzipped, budget 32)`);
  }

  try {
    // A generated choice is a conversation reply, even when the composer has
    // been switched to saving feedback. It must never file a report.
    {
      const t = await open(browser, b, { visual: true, width: 390, height: 800 });
      await t.p.locator(`${root} .fab`).click();
      const input = t.p.locator(`${root} .ck-input`);
      await input.waitFor({ timeout: 5000 });
      await input.fill("Help me decide");
      await input.press("Enter");
      await t.p.locator(`${root} .ck-choice`).waitFor({ timeout: 5000 });
      await t.p.locator(`${root} .ck-mode`).filter({ hasText: "Save feedback" }).click();
      await t.p
        .locator(`${root} .ck-choice-option`)
        .filter({ hasText: "Compare alternatives" })
        .click();
      const response = t.p.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/widget/advise",
      );
      await t.p.locator(`${root} .ck-choice-submit`).click();
      await response;
      await t.p.locator(`${root} .ck-choice`).nth(1).waitFor({ timeout: 5000 });
      ok(
        t.asked.at(-1)?.question === "Please compare the alternatives",
        "a guided choice asks the assistant through its normal handler",
      );
      ok(
        t.reports.length === 0,
        "a guided reply never files feedback in the selected composer mode",
      );
      ok(t.errors.length === 0, "the visual answer has no browser errors");
      await t.close();
    }
    // ── The panel draws its conversation with chatkit ────────────────────────
    {
      const t = await open(browser, b);
      ok(!t.chunkFetched(), "the chat chunk is not fetched before the panel opens");
      await t.p.locator(`${root} .fab`).click();
      await t.p.locator(`${root} .fc-kit .ck-input`).waitFor({ timeout: 5000 });
      ok(t.chunkFetched(), "opening the panel fetches /widget-chat.js");
      ok(
        await t.p
          .locator(`${root} .chatlog`)
          .evaluate((e) => getComputedStyle(e).display === "none"),
        "the vanilla thread steps aside",
      );
      const greeting = await t.p.locator(`${root} .ck-thread`).innerText();
      ok(/Loki/.test(greeting), `the greeting is in chatkit's thread (${greeting.slice(0, 60)})`);
      ok(
        (await t.p.locator(`${root} .ck-composer .ctxbar`).count()) === 1,
        "the scope menu sits inside chatkit's composer",
      );
      const modes = await t.p.locator(`${root} .ck-mode`).allInnerTexts();
      ok(
        modes[0] === "Ask" && modes[1] === "Save feedback",
        `chat and site feedback are named as two clear intents (${modes.join(" / ")})`,
      );
      // chatkit's colours come from the widget's theme, not the host's tokens,
      // and its rem sizes do not follow the host's 10px root.
      const frame = await t.p.locator(`${root} .ck-composer`).evaluate((e) => {
        const s = getComputedStyle(e);
        return {
          bg: s.backgroundColor,
          gap: getComputedStyle(e.closest(".fc-kit")!.querySelector(".ck-thread-inner")!).rowGap,
        };
      });
      // .ck-thread-inner's gap is 1.25rem: 20px at the widget's 16px, 12.5 at the host's 10.
      ok(frame.gap === "20px", `chatkit's rem is the widget's 16px, not the host's (${frame.gap})`);
      ok(
        frame.bg !== "rgba(0, 0, 0, 0)" && frame.bg !== "",
        `the composer is painted (${frame.bg})`,
      );

      // Chat: Enter in chatkit's own composer.
      const input = t.p.locator(`${root} .ck-input`);
      await input.fill("Is the booking button clear?");
      await input.press("Enter");
      await t.p.locator(`${root} .change-send`).waitFor({ timeout: 5000 });
      ok(t.asked.at(-1)?.question === "Is the booking button clear?", "Enter asks Loki");
      const keys = await t.p.evaluate(() => (window as unknown as { hostKeys: string[] }).hostKeys);
      ok(
        !keys.includes("Enter") && !keys.includes("I"),
        `the host never sees panel typing (${keys})`,
      );
      const thread = await t.p.locator(`${root} .ck-thread`).innerText();
      ok(thread.includes("Is the booking button clear?"), "your words are in the thread");
      ok(thread.includes("which does not tell a guest"), "…and Loki's answer");
      ok(
        (await t.p.locator(`${root} .ck-thread strong`).count()) > 0,
        "the answer's markdown is drawn by chatkit",
      );

      // Its change, sent to the builder: the card, then the receipt.
      await t.p.locator(`${root} .change-send`).first().click();
      await t.p.locator(`${root} .fc-kit-after .sendcard`).waitFor({ timeout: 3000 });
      ok(true, "Send to builder opens the confirmation card after the last turn");
      await t.p.locator(`${root} .sendcard input`).fill("ann@example.com");
      await t.p.locator(`${root} .sendcard .go`).click();
      await t.p.waitForTimeout(400);
      ok(t.reports.length === 1, "the card files the report");
      ok(String(t.reports[0]?.suggestion).includes("Book your stay"), "…with the change");
      ok(t.reports[0]?.contact === "ann@example.com", "…and who sent it");
      ok(
        (await t.p.locator(`${root} .fc-kit-after .sendcard`).count()) === 0,
        "the card goes once sent",
      );
      ok(
        (await t.p.locator(`${root} .ck-thread a.track`).count()) === 1,
        "the receipt's track link is under its message",
      );

      // The thread is bounded inside the panel: it scrolls, and it ends
      // inside the card. (It was a fixed max-height; the panel is now one
      // column whose thread takes the room between header and composer —
      // theme.ts — so what to pin is the outcome, not the old mechanism.)
      const wrap = await t.p.locator(`${root} .fc-kit .ck-thread-wrap`).evaluate((e) => {
        const panel = e.closest(".panel")!.getBoundingClientRect();
        const r = e.getBoundingClientRect();
        return {
          scrolls: getComputedStyle(e).overflowY === "auto",
          inside: r.top >= panel.top - 0.5 && r.bottom <= panel.bottom + 0.5,
          panelFits: panel.bottom <= innerHeight + 0.5,
        };
      });
      ok(
        wrap.scrolls && wrap.inside && wrap.panelFits,
        `the thread is bounded inside the panel (${JSON.stringify(wrap)})`,
      );

      // Escape still closes the panel (chatkit's composer does not swallow it).
      await input.press("Escape");
      ok((await t.p.locator(`${root} .panel`).count()) === 0, "Escape closes the panel");
      ok(t.errors.length === 0, `no page errors (${t.errors.join(" | ")})`);
      await t.close();
    }

    // ── A screenshot attached in chatkit goes with the note ─────────────────
    {
      const t = await open(browser, b);
      await t.p.locator(`${root} .fab`).click();
      await t.p.locator(`${root} .fc-kit .ck-input`).waitFor({ timeout: 5000 });
      // A real 1×1 PNG: chatkit decodes and re-encodes what it attaches.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      await t.p
        .locator(`${root} .ck-composer input[type=file]`)
        .first()
        .setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png });
      await t.p.locator(`${root} .ck-attach-item`).waitFor({ timeout: 3000 });
      await t.p.locator(`${root} .ck-mode`, { hasText: "Save feedback" }).click();
      const input = t.p.locator(`${root} .ck-input`);
      await input.fill("The phone number is wrong");
      await input.press("Enter");
      await t.p.locator(`${root} .fc-kit-after .sendcard`).waitFor({ timeout: 3000 });
      ok(t.asked.length === 0, "Save feedback does not ask Loki");
      const note = await t.p.locator(`${root} .sendcard .diag`).innerText();
      ok(note.includes("1 screenshot"), `the card says the screenshot goes with it (${note})`);
      await t.p.locator(`${root} .sendcard .go`).click();
      await t.p.waitForTimeout(400);
      const shots = t.reports[0]?.screenshots ?? [];
      ok(shots.length === 1 && shots[0].startsWith("data:image/"), "the report carries it");
      ok(t.errors.length === 0, `no page errors (${t.errors.join(" | ")})`);
      await t.close();
    }

    // ── No chunk, no dead end ───────────────────────────────────────────────
    {
      const t = await open(browser, b, { chunk: false });
      await t.p.locator(`${root} .fab`).click();
      await t.p.waitForTimeout(600);
      ok(t.chunkFetched(), "the chunk was asked for");
      ok((await t.p.locator(`${root} .fc-kit`).count()) === 0, "it did not load");
      const input = t.p.locator(`${root} .convo .composer .chatinput`);
      ok(await input.isVisible(), "the panel's own composer is still there");
      await input.fill("Still works?");
      await input.press("Enter");
      await t.p.waitForTimeout(400);
      ok(t.asked.at(-1)?.question === "Still works?", "…and still asks");
      await t.close();
    }

    // ── Without the attribute nothing changes ───────────────────────────────
    {
      const t = await open(browser, b, { kit: false });
      await t.p.locator(`${root} .fab`).click();
      await t.p.waitForTimeout(600);
      ok(!t.chunkFetched(), "without data-fc-chat the chunk is never fetched");
      await t.close();
    }

    // ── A phone ─────────────────────────────────────────────────────────────
    {
      const t = await open(browser, b, { width: 360 });
      await t.p.locator(`${root} .fab`).click();
      await t.p.locator(`${root} .fc-kit .ck-input`).waitFor({ timeout: 5000 });
      const wide = await t.p.locator(`${root} .panel`).evaluate((panel) => {
        const out: string[] = [];
        const edge = panel.getBoundingClientRect().right + 0.5;
        // A chip in a row you swipe sideways (overflow-x: auto) is clipped
        // by that row on purpose — on a phone the suggested replies are one
        // such row. Poking out means VISIBLY past the panel's edge.
        panel.querySelectorAll("*").forEach((n) => {
          const r = n.getBoundingClientRect();
          if (!r.width || r.right <= edge) return;
          // (Inline, not a named helper: tsx wraps named functions in a
          // `__name` call that does not exist inside the page.)
          for (let e = n.parentElement; e && e !== panel; e = e.parentElement)
            if (/(auto|scroll)/.test(getComputedStyle(e).overflowX)) return;
          out.push(`${n.className}`.slice(0, 40));
        });
        return { out, doc: document.documentElement.scrollWidth };
      });
      ok(
        wide.out.length === 0,
        `nothing pokes out of the panel at 360px (${wide.out.slice(0, 4)})`,
      );
      ok(wide.doc <= 360, `no sideways scroll (${wide.doc})`);
      await t.close();
    }

    // ── Send is on screen and a tap on it reaches it ────────────────────────
    // loki.orangecat.ch at 1280×860, 2026-10-17: Send sat below the panel's
    // scroll box, under "Made with Loki" — measured by what a tap HITS.
    for (const [width, height] of [
      [390, 667],
      [360, 640],
      [1280, 720],
    ]) {
      const t = await open(browser, b, { width, height });
      await t.p.locator(`${root} .fab`).click();
      await t.p.locator(`${root} .fc-kit .ck-input`).waitFor({ timeout: 5000 });
      await t.p.waitForTimeout(300);
      const reach = await t.p.locator(`${root} .fc-kit .ck-send`).evaluate((send) => {
        const r = (send.getRootNode() as ShadowRoot).elementFromPoint(
          send.getBoundingClientRect().left + send.getBoundingClientRect().width / 2,
          send.getBoundingClientRect().top + send.getBoundingClientRect().height / 2,
        );
        const b = send.getBoundingClientRect();
        return {
          onScreen: b.height > 0 && b.top >= 0 && b.bottom <= innerHeight,
          reached: !!r && (r === send || send.contains(r)),
          hit: r ? `${(r as HTMLElement).className}`.slice(0, 40) || r.tagName : null,
        };
      });
      ok(
        reach.onScreen && reach.reached,
        `${width}×${height}: a tap on Send reaches Send (${JSON.stringify(reach)})`,
      );
      await t.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
