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
type Report = { suggestion: string; scope?: string; contact?: string };

async function open(
  browser: Browser,
  body: string,
  js: string,
  o: { width?: number; height?: number; withMic?: boolean; colorScheme?: "light" | "dark" } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width: o.width ?? 1200, height: o.height ?? 800 },
    colorScheme: o.colorScheme,
  });
  const p = await ctx.newPage();
  // Every real browser has a mic; this test browser does not, and a composer
  // checked only without one shipped with Ask Loki pushed out of the panel.
  if (o.withMic)
    // A string, not a function: tsx wraps functions in a `__name` helper that
    // does not exist in the page, and the init script then dies on line one.
    await p.addInitScript(`
      Object.defineProperty(Navigator.prototype, "mediaDevices", {
        configurable: true,
        get: () => ({ getUserMedia: () => Promise.reject(new Error("test")) }),
      });
      Object.defineProperty(document, "featurePolicy", {
        configurable: true,
        value: { allowsFeature: () => true },
      });
    `);
  const errors: string[] = [];
  const advised: Advise[] = [];
  const reports: Report[] = [];
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
        themes: PALETTE.widgetThemes,
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
    if (url.pathname === "/api/feedback") {
      reports.push(JSON.parse(route.request().postData() ?? "{}") as Report);
      return json({ ok: true, claimUrl: "https://loki.test/claim-feedback/x" });
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
  return { p, errors, advised, reports, close: () => ctx.close() };
}

/** Type into the conversation's composer and press its button. */
const say = (p: Page, text: string) =>
  p.evaluate((text) => {
    const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
    const input = r.querySelector(".convo .composer .chatinput") as HTMLTextAreaElement;
    input.value = text;
    input.dispatchEvent(new Event("input"));
    (r.querySelector(".convo .composer .go") as HTMLElement).click();
  }, text);

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
          .shadowRoot!.querySelector(".sendcard textarea") as HTMLTextAreaElement
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

  // An embed can pin its surface; without a pin it follows device appearance.
  for (const [choice, scheme] of [
    ["light", "dark"],
    ["dark", "light"],
  ] as const) {
    const t = await open(browser, tag(`async data-fc-theme="${choice}"`), js, {
      colorScheme: scheme,
    });
    await click(t.p, ".fab");
    const mode = await t.p.evaluate(() =>
      document.getElementById("loki-feedback-host")!.getAttribute("data-lk-theme"),
    );
    ok(mode === choice, `${choice} override wins over system appearance (${mode})`);
    await t.close();
  }
  {
    const t = await open(browser, tag(), js, { colorScheme: "light" });
    await click(t.p, ".fab");
    const mode = await t.p.evaluate(() =>
      document.getElementById("loki-feedback-host")!.getAttribute("data-lk-theme"),
    );
    ok(mode === "light", "automatic theme follows the browser appearance");
    await t.close();
  }

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

  // ---- the panel fits: nothing scrolls sideways, every button is inside it ----
  for (const width of [1200, 390, 320]) {
    const t = await open(browser, tag(), js, { width, withMic: true });
    await click(t.p, ".fab");
    const fit = await t.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const panel = r.querySelector(".panel") as HTMLElement;
      const box = panel.getBoundingClientRect();
      const outside = Array.from(r.querySelectorAll(".panel button"))
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .filter((b) => {
          const x = b.getBoundingClientRect();
          if (x.right <= box.right + 0.5 && x.left >= box.left - 0.5) return false;
          // A chip in a row you swipe (overflow-x: auto) is clipped by that
          // row on purpose — on a phone the starters are one such row.
          for (let e = b.parentElement; e && e !== panel; e = e.parentElement)
            if (/(auto|scroll)/.test(getComputedStyle(e).overflowX)) return false;
          return true;
        })
        .map((b) => (b as HTMLElement).innerText || b.getAttribute("aria-label"));
      return {
        // One way to talk: the Talk bar above the box, or dictation in it.
        mic: !!r.querySelector(".talk-hero, .composer .mic"),
        scrolls: panel.scrollWidth > panel.clientWidth + 1,
        outside,
      };
    });
    ok(fit.mic, `${width}px: the panel has its microphone (as in a real browser)`);
    ok(!fit.scrolls, `${width}px: the panel does not scroll sideways`);
    ok(
      fit.outside.length === 0,
      `${width}px: no button outside the panel (${fit.outside.join(", ")})`,
    );
    await t.close();
  }

  // ---- the send control is on screen, and a tap on it reaches it ----
  // Production, 2026-10-17: on a 390×760 phone the composer scrolled with the
  // conversation and opened half below the fold, so a tap on Send landed on
  // "Made with Loki" instead (a new tab, the note unsent). Every test opened
  // the panel 800px tall, which hid it. Measured by what a tap HITS, at the
  // heights people actually have — and again after a message, when the
  // thread grows.
  for (const [width, height] of [
    [390, 760],
    [390, 667],
    [360, 640],
    [320, 568],
    [1280, 720],
  ]) {
    const t = await open(browser, tag(), js, { width, height, withMic: true });
    await click(t.p, ".fab");
    await t.p.waitForTimeout(400);
    const reach = () =>
      t.p.evaluate(() => {
        const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
        const send = r.querySelector(".convo .composer .go") as HTMLElement;
        const b = send.getBoundingClientRect();
        const hit = r.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return {
          onScreen: b.height > 0 && b.top >= 0 && b.bottom <= innerHeight,
          reached: !!hit && (hit === send || send.contains(hit)),
          hit: hit ? (hit as HTMLElement).className || hit.tagName : null,
        };
      });
    // The causes, not only the symptom: this fixture reached Send while
    // orangecat.ch at 390×667 did not, because there the starters were a
    // 129px stack (the phone rule lost to a later base rule) and the footer
    // wrapped to two rows. On a phone both must be one row.
    if (width <= 480 && width >= 360) {
      const rows = await t.p.evaluate(() => {
        const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
        return {
          starters: Math.round(r.querySelector(".starters")?.getBoundingClientRect().height ?? 0),
          foot: Math.round(r.querySelector(".panel-foot")?.getBoundingClientRect().height ?? 0),
        };
      });
      ok(
        rows.starters <= 52 && rows.foot <= 48,
        `${width}×${height}: starters and footer are one row each (${JSON.stringify(rows)})`,
      );
    }
    const first = await reach();
    ok(
      first.onScreen && first.reached,
      `${width}×${height}: a tap on Send reaches Send on opening (${JSON.stringify(first)})`,
    );
    await say(t.p, "Is the booking form clear?");
    await t.p.waitForTimeout(500);
    const after = await reach();
    ok(
      after.onScreen && after.reached,
      `${width}×${height}: …and still after a message (${JSON.stringify(after)})`,
    );
    await t.close();
  }

  // ---- feedback, just like before: pick what it is about, write, send — no AI ----
  {
    const t = await open(browser, tag(), js);
    await click(t.p, ".fab");
    await click(t.p, ".scopebtn");
    ok(
      JSON.stringify(await texts(t.p, ".segbtn")) ===
        JSON.stringify(["This page", "Whole site", "Loki itself"]),
      "the compact scope menu keeps this page, the whole site and Loki itself available",
    );
    await click(t.p, ".pointbtn");
    await t.p.waitForTimeout(150);
    const b = await t.p.$eval("#book", (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await t.p.mouse.click(b.x, b.y);
    const done = (await texts(t.p, ".pickbar button")).findIndex((s) => /done/i.test(s));
    await click(t.p, ".pickbar button", done);
    await t.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const input = r.querySelector(".composer .chatinput") as HTMLTextAreaElement;
      input.value = "This should say Book now";
      input.dispatchEvent(new Event("input"));
    });
    ok(
      (await texts(t.p, ".composer .feedback"))[0] === "Save feedback",
      "Save feedback is right there",
    );
    await click(t.p, ".composer .feedback");
    ok(
      (await reportText(t.p)) === "This should say Book now",
      "…opening the confirmation directly",
    );
    await click(t.p, ".sendcard .go");
    await t.p.waitForTimeout(400);
    ok(t.advised.length === 0, "feedback never waits on an AI answer");
    const r = t.reports[0] as (Report & { selectedElements?: { selector: string }[] }) | undefined;
    ok(
      r?.suggestion === "This should say Book now" && r?.scope === "element",
      "filed, about the element",
    );
    ok(r?.selectedElements?.[0]?.selector.includes("book") ?? false, "with the element attached");
    await t.close();
  }

  // ---- one conversation: ask Loki, then send what it recommends ----
  {
    const t = await open(browser, tag(), js);
    await click(t.p, ".fab");
    ok((await texts(t.p, ".mode")).length === 0, "no tabs: one conversation, not three tools");
    ok((await texts(t.p, ".watchbtn")).length === 0, "owner-only Watch is not offered to visitors");
    const door = await t.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const a = r.querySelector(".door") as HTMLAnchorElement;
      return a.href;
    });
    const signIn = new URL(door);
    ok(
      signIn.pathname === "/api/widget/owner" &&
        signIn.searchParams.get("token") === "fcw_fixture" &&
        signIn.searchParams.get("return") === `${ORIGIN}/`,
      `the owner sign-in stays under the greeting where it is relevant (${door})`,
    );

    await click(t.p, ".scopebtn");
    const keyboardScope = await t.p.evaluate(() => {
      const root = document.getElementById("loki-feedback-host")!.shadowRoot!;
      root.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      const moved = root.activeElement?.textContent;
      root.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      const button = root.querySelector(".scopebtn") as HTMLButtonElement;
      const escaped =
        button.getAttribute("aria-expanded") === "false" && root.activeElement === button;
      button.click();
      root
        .querySelector(".hdr .page")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      return { moved, escaped, outsideClosed: button.getAttribute("aria-expanded") === "false" };
    });
    ok(keyboardScope.moved === "Whole site", "scope menu supports arrow-key navigation");
    ok(keyboardScope.escaped, "Escape closes scope and returns focus");
    ok(keyboardScope.outsideClosed, "tapping outside the scope menu dismisses it");
    await click(t.p, ".scopebtn");
    await click(t.p, ".segbtn", 1); // Whole site
    ok(
      (await t.p.evaluate(
        () =>
          document.getElementById("loki-feedback-host")!.shadowRoot!.querySelector(".segbtn.on")
            ?.textContent,
      )) === "Whole site",
      "page / whole site / element is one control, as before",
    );
    await click(t.p, ".starter", 0);
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
    ok((await texts(t.p, ".act")).length === 1, "your own words are one tap from the builder too");
    await click(t.p, ".change-send");
    ok(
      (await reportText(t.p)) === "Change the button text from 'Submit' to 'Book your stay'",
      "Send to builder opens a confirmation in the thread, prefilled",
    );
    await click(t.p, ".sendcard .go");
    await t.p.waitForTimeout(400);
    ok(t.reports.length === 1, `one report filed (got ${t.reports.length})`);
    ok(
      t.reports[0]?.suggestion === "Change the button text from 'Submit' to 'Book your stay'",
      "with exactly the change",
    );
    ok(
      (await texts(t.p, ".msg.sent"))[0]?.includes("Track what happens next") ?? false,
      "the receipt lands in the thread, with its tracking link",
    );

    // The conversation survives the site's own page loads.
    await t.p.reload();
    await t.p.waitForTimeout(1200);
    await click(t.p, ".fab");
    const after = await texts(t.p, ".convo .msg");
    ok(
      after.some((m) => m.includes("does not tell a guest")) &&
        after.some((m) => m.includes("Track what happens next")),
      "after a reload the conversation is still there",
    );
    ok(t.errors.length === 0, `no page errors (${t.errors.join("; ")})`);
    await t.close();
  }
  {
    const t = await open(browser, tag(), js);
    await click(t.p, ".fab");
    await click(t.p, ".pointbtn"); // Point to area → picker
    await t.p.waitForTimeout(150);
    const b = await t.p.$eval("#book", (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await t.p.mouse.move(b.x, b.y);
    await t.p.mouse.click(b.x, b.y);
    const done = (await texts(t.p, ".pickbar button")).findIndex((s) => /done/i.test(s));
    await click(t.p, ".pickbar button", done);
    ok((await texts(t.p, ".scopebtn"))[0]?.startsWith("1 area") ?? false, "the pick is shown");
    await say(t.p, "Is this button fine?");
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
    await say(t.p, "The phone number is wrong");
    await t.p.waitForTimeout(300);
    ok(t.advised.length === 0, 'data-fc-modes="report" opts a site out of AI answers');
    ok(
      (await reportText(t.p)) === "The phone number is wrong",
      "…and a message goes straight to the send confirmation",
    );
    await t.close();
  }

  {
    // A host page that binds "/" and ⌘K on document (orangecat.ch, Loki
    // itself). With the panel open, keys typed into it are the panel's: the
    // host never sees them, AND every control inside the panel that listens
    // for itself still does — the shared chat's composer handles its own
    // Enter, and a document capture-phase stop once starved it of every key.
    const hostKeys = `<script>window.__hostKeys = [];
      document.addEventListener("keydown", (e) => window.__hostKeys.push(e.key));</script>`;
    const t = await open(browser, hostKeys + tag(), js);
    await click(t.p, ".fab");
    await t.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const input = r.querySelector(".convo .composer .chatinput") as HTMLTextAreaElement;
      (window as unknown as { __inner: string[] }).__inner = [];
      input.addEventListener("keydown", (e) =>
        (window as unknown as { __inner: string[] }).__inner.push(e.key),
      );
      input.focus();
    });
    await t.p.keyboard.type("Is / fine?");
    await t.p.keyboard.press("Enter");
    await t.p.waitForTimeout(500);
    const seen = await t.p.evaluate(() => ({
      host: (window as unknown as { __hostKeys: string[] }).__hostKeys,
      inner: (window as unknown as { __inner: string[] }).__inner,
    }));
    ok(
      seen.host.length === 0,
      `the host page's hotkeys never see panel typing (${seen.host.join(",")})`,
    );
    ok(
      seen.inner.includes("/") && seen.inner.includes("Enter"),
      "a control inside the panel still gets its keys",
    );
    ok(t.advised.length === 1, "Enter in the composer asks Loki");
    await t.p.keyboard.press("Escape");
    await t.p.waitForTimeout(200);
    ok((await texts(t.p, ".convo .composer")).length === 0, "Escape closes the panel");
    await t.close();
  }

  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
