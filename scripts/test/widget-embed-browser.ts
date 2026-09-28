// Installing and hiding the widget, and asking Loki before requesting a change
// — proven in a real browser, because every one of these failed there while
// every pure test passed.
//
// What was found by driving the real bundle (2026-09-28), each pinned below:
//   - a `type="module"` tag rendered nothing (document.currentScript is null);
//   - two copies of the tag rendered two launchers;
//   - "Hide on this site" lived only behind a long-press / right-click, and was
//     one-way: after a reload nothing — not #loki, not the host's own
//     Loki.report() — could bring the widget back.
// And the new Ask mode: a recommended change must land in Report prefilled, the
// "whole site" snapshot must actually include other pages, and a picked
// element's snapshot must not carry our own highlight classes.
//
// Run: npx tsx scripts/test/widget-embed-browser.ts (needs Chromium; CI has it).
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PALETTE } from "../../src/lib/palette";

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
const tag = (extra = "async") =>
  `<script src="${ORIGIN}/widget.js" data-fc-project="fcw_fixture" ${extra}></script>`;
const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Farmhouse</title><meta name="description" content="A farm stay">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<header><nav><a href="/rooms">Rooms</a> <a href="/contact">Contact</a></nav></header>
<main><h1>Welcome to the farm</h1><p>Stay with us.</p><button id="book">Submit</button></main>
${body}</body></html>`;

type Advise = { scope: string; question: string; snapshot: string };

async function open(browser: Browser, body: string, js: string) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  const advised: Advise[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ body: JSON.stringify(body), contentType: "application/json" });
    if (url.pathname === "/widget.js") {
      return route.fulfill({ body: js, contentType: "text/javascript" });
    }
    if (url.pathname === "/api/widget-boot") {
      return json({
        active: true,
        placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
        theme: PALETTE.widget,
      });
    }
    if (url.pathname === "/api/widget/advise") {
      advised.push(JSON.parse(route.request().postData() ?? "{}") as Advise);
      return json({
        ok: true,
        reply: "The button says Submit, which does not tell a guest what happens.",
        changes: ["Change the button text from 'Submit' to 'Book your stay'"],
      });
    }
    if (url.pathname === "/rooms") {
      return route.fulfill({
        body: "<html><head><title>Rooms</title></head><body><h1>Our rooms</h1></body></html>",
        contentType: "text/html",
      });
    }
    return route.fulfill({ body: page(body), contentType: "text/html" });
  });
  await p.goto(`${ORIGIN}/`);
  await p.waitForTimeout(1200);
  return { p, errors, advised, close: () => ctx.close() };
}

const hosts = (p: Page) =>
  p.evaluate(() => document.querySelectorAll("#loki-feedback-host").length);
const texts = (p: Page, sel: string) =>
  p.evaluate((sel) => {
    const r = document.getElementById("loki-feedback-host")?.shadowRoot;
    return r ? [...r.querySelectorAll(sel)].map((e) => (e as HTMLElement).innerText) : [];
  }, sel);
const click = (p: Page, sel: string, i = 0) =>
  p.evaluate(
    ([sel, i]) =>
      (
        document.getElementById("loki-feedback-host")!.shadowRoot!.querySelectorAll(sel as string)[
          i as number
        ] as HTMLElement
      ).click(),
    [sel, i] as const,
  );
const fabShown = (p: Page) =>
  p.evaluate(() => {
    const fab = document.getElementById("loki-feedback-host")?.shadowRoot?.querySelector(".fab");
    return !!fab && getComputedStyle(fab).display !== "none";
  });
const reportText = (p: Page) =>
  p.evaluate(
    () =>
      (
        document
          .getElementById("loki-feedback-host")!
          .shadowRoot!.querySelector(".report-view textarea") as HTMLTextAreaElement
      ).value,
  );

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
  const out = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const js = out.outputFiles[0].text;

  // ---- installing ----
  for (const [label, body] of [
    ["async tag", tag("async")],
    ["defer tag", tag("defer")],
    ["module tag", tag('type="module"')],
    [
      "injected tag",
      `<script>var s=document.createElement('script');s.src='${ORIGIN}/widget.js';` +
        `s.setAttribute('data-fc-project','fcw_fixture');document.head.appendChild(s);</script>`,
    ],
  ]) {
    const t = await open(browser, body, js);
    ok((await hosts(t.p)) === 1 && (await fabShown(t.p)), `${label}: one launcher renders`);
    ok(t.errors.length === 0, `${label}: no page errors (${t.errors.join("; ")})`);
    await t.close();
  }
  {
    const t = await open(browser, tag() + tag(), js);
    ok((await hosts(t.p)) === 1, "two copies of the tag render ONE launcher");
    await t.close();
  }

  // ---- hiding, and getting it back ----
  {
    const t = await open(browser, tag(), js);
    await click(t.p, ".fab");
    ok((await texts(t.p, ".hide-link")).length === 1, "the panel offers a visible hide control");
    await click(t.p, ".hide-link");
    ok(!(await fabShown(t.p)), "hiding removes the launcher");
    ok((await texts(t.p, ".toast"))[0]?.includes("#loki"), "the hide toast says how to undo it");
    await click(t.p, ".toast-undo");
    ok(await fabShown(t.p), "Undo brings the launcher straight back");

    await click(t.p, ".fab");
    await click(t.p, ".hide-link");
    await t.p.reload();
    await t.p.waitForTimeout(1200);
    ok((await hosts(t.p)) === 0, "hidden stays hidden across a reload");
    ok(
      await t.p.evaluate(() => (window as unknown as { Loki: { ready: boolean } }).Loki.ready),
      "Loki.ready is still true while hidden — the host's own Report control works",
    );
    await t.p.evaluate(() =>
      (window as unknown as { Loki: { report(i: object): void } }).Loki.report({
        message: "from the host",
      }),
    );
    await t.p.waitForTimeout(200);
    ok((await reportText(t.p)) === "from the host", "Loki.report() opens a hidden widget");

    await click(t.p, ".x");
    await click(t.p, ".fab");
    await click(t.p, ".hide-link");
    await t.p.evaluate(() => {
      location.hash = "loki";
    });
    await t.p.waitForTimeout(200);
    ok(await fabShown(t.p), "typing #loki on an open page restores the launcher");
    ok((await t.p.evaluate(() => location.hash)) === "", "#loki is removed from the address");

    await click(t.p, ".fab");
    await click(t.p, ".hide-link");
    await t.p.goto(`${ORIGIN}/other#loki`);
    await t.p.waitForTimeout(1200);
    ok(await fabShown(t.p), "arriving with #loki restores the launcher");
    await t.close();
  }

  // ---- Ask Loki, then request what it recommends ----
  {
    const t = await open(browser, tag(), js);
    await click(t.p, ".fab");
    ok(
      JSON.stringify(await texts(t.p, ".mode")) ===
        JSON.stringify(["Request a change", "Ask Loki"]),
      "a default embed offers Request a change + Ask Loki",
    );
    await click(t.p, ".mode", 1);
    await click(t.p, ".chip", 2); // Whole site
    ok(
      (await texts(t.p, ".advise .starter"))[0] === "How can we make the website better?",
      "whole-site starters are about the whole site",
    );
    await click(t.p, ".advise .starter", 0);
    await t.p.waitForTimeout(800);
    const sent = t.advised[0];
    ok(sent?.scope === "site", "the question is sent with the whole-site scope");
    ok(!!sent?.snapshot.includes("Our rooms"), "the site snapshot includes another page");
    ok(
      !!sent?.snapshot.includes("Welcome to the farm Stay with us."),
      "page text keeps its word boundaries",
    );
    ok(
      (await texts(t.p, ".change-text"))[0]?.includes("Book your stay") ?? false,
      "the recommended change is listed",
    );
    await click(t.p, ".change-send");
    ok((await texts(t.p, ".hdr b"))[0] === "What should change?", "Request this → opens Report");
    ok(
      (await reportText(t.p)) === "Change the button text from 'Submit' to 'Book your stay'",
      "…prefilled with the recommended change",
    );
    await t.close();
  }
  {
    const t = await open(browser, tag(), js);
    await click(t.p, ".fab");
    await click(t.p, ".mode", 1);
    await click(t.p, ".chip", 0); // An element → picker
    await t.p.waitForTimeout(150);
    const b = await t.p.$eval("#book", (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await t.p.mouse.move(b.x, b.y);
    await t.p.mouse.click(b.x, b.y);
    const done = (await texts(t.p, ".pickbar button")).findIndex((s) => /done/i.test(s));
    await click(t.p, ".pickbar button", done);
    await t.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const input = r.querySelector(".advise textarea") as HTMLTextAreaElement;
      input.value = "Is this button fine?";
      input.dispatchEvent(new Event("input"));
      (r.querySelector(".advise .go") as HTMLElement).click();
    });
    await t.p.waitForTimeout(600);
    const sent = t.advised[0];
    ok(sent?.scope === "element", "an element question is sent with the element scope");
    ok(
      !!sent?.snapshot.includes('<button id="book">Submit</button>'),
      "…with the element's markup",
    );
    ok(!sent?.snapshot.includes("fcw-"), "…without the picker's own highlight classes");
    await t.close();
  }
  {
    const t = await open(browser, tag('async data-fc-modes="report"'), js);
    await click(t.p, ".fab");
    ok(
      JSON.stringify(await texts(t.p, ".mode")) === JSON.stringify(["Request a change"]),
      'data-fc-modes="report" opts a site out of Ask',
    );
    await t.close();
  }

  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
