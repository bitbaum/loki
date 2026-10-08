// Watch mode in a real browser: the owner sees "Loki is watching" the whole
// time; a request the site makes that fails with a 500 files ONE report with
// the trail (the tap that led there included, the typed value excluded);
// Pause stops it, and paused, a failure files nothing. A visitor without the
// owner pass gets no pill and no recording at all.
// Run: npx tsx scripts/test/widget-watch-browser.ts
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
const SITE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main><h1>Shop</h1><input id="email" placeholder="Your email">
<button id="buy">Buy now</button><button id="dead">Save</button><button id="ok">Refresh</button>
<button id="find">Find a size</button><button id="icon"><svg width="10" height="10"></svg></button>
<img src="/shop/hero.png" width="40" height="40"><button id="jank">Load more</button>
<nav><a href="/roomy" style="display:inline-block;height:20px;margin:24px">Roomy nav link</a></nav>
<div><a href="/p1" style="display:inline-block;width:16px;height:16px">1</a><a href="/p2" style="display:inline-block;width:16px;height:16px">2</a></div></main>
<footer style="content-visibility:auto;margin-top:4000px"><a href="/about">About the shop</a></footer>
<script>document.getElementById("buy").onclick = () => fetch("/shop/checkout?token=secret", { method: "POST" });
document.getElementById("ok").onclick = () => fetch("/shop/ok");
document.getElementById("find").onclick = () => fetch("/shop/sizes?user=secret");
// A janky "Load more": freezes the main thread, then pushes everything down.
document.getElementById("jank").onclick = () => {
  const until = performance.now() + 450; while (performance.now() < until) {}
  setTimeout(() => { const b = document.createElement("div"); b.style.height = "320px";
    b.textContent = "Banner"; document.querySelector("main").prepend(b); }, 900);
};</script>
<script src="${ORIGIN}/widget.js" data-fc-project="fcw_fixture" async></script></body></html>`;

type Report = { suggestion: string; ownerPass?: string };
type Advice = { question: string; scope: string; session?: string };

async function open(browser: Browser, js: string, hash: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  const reports: Report[] = [];
  const advice: Advice[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, body: JSON.stringify(body), contentType: "application/json" });
    if (url.pathname === "/widget.js")
      return route.fulfill({ body: js, contentType: "text/javascript" });
    if (url.pathname === "/api/widget-boot") {
      return json({
        active: true,
        placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
        theme: PALETTE.widget,
      });
    }
    if (url.pathname === "/api/feedback") {
      reports.push(JSON.parse(route.request().postData() ?? "{}") as Report);
      return json({ ok: true, owner: true, building: true });
    }
    if (url.pathname === "/shop/checkout") return json({ error: "boom" }, 500);
    if (url.pathname === "/api/widget/advise") {
      advice.push(JSON.parse(route.request().postData() ?? "{}") as Advice);
      return json({
        ok: true,
        reply: "You were looking for a size. **Errors:** the size lookup 404s.",
        changes: ["Make “Find a size” show the size chart instead of failing"],
      });
    }
    if (url.pathname === "/shop/ok") return json({ ok: true });
    if (url.pathname === "/shop/sizes") return json({ error: "not found" }, 404);
    if (url.pathname === "/shop/hero.png") return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ body: SITE, contentType: "text/html" });
  });
  await p.goto(`${ORIGIN}/${hash}`);
  await p.waitForTimeout(1000);
  return { p, errors, reports, advice, close: () => ctx.close() };
}

/** The recorded trail, as the tab keeps it across page loads. */
const trailText = (p: Page) =>
  p.evaluate(() => sessionStorage.getItem("loki-watch-trail:fcw_fixture") ?? "");

/** Click a pill button by its label — the pill's buttons are Review, Report, Pause. */
const clickPill = (p: Page, label: string) =>
  p.evaluate((label) => {
    const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
    const btn = Array.from(r.querySelectorAll(".watch-pill .wbtn")).find(
      (b) => (b as HTMLElement).innerText.trim() === label,
    ) as HTMLElement | undefined;
    if (!btn) throw new Error(`no pill button "${label}"`);
    btn.click();
  }, label);

const pillText = (p: Page) =>
  p.evaluate(() => {
    const el = document
      .getElementById("loki-feedback-host")
      ?.shadowRoot?.querySelector(".watch-pill .wtext") as HTMLElement | null;
    return el?.innerText ?? null;
  });
/** The pill's last button is Pause / Resume (Report sits before it). */
const clickPillButton = (p: Page) =>
  p.evaluate(() => {
    const all = document
      .getElementById("loki-feedback-host")!
      .shadowRoot!.querySelectorAll(".watch-pill .wbtn");
    (all[all.length - 1] as HTMLElement).click();
  });

async function main() {
  let browser: Browser;
  try {
    browser = await chromium.launch(
      process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    );
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

  // ---- the owner: watched, visibly, and a failure files one report ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    // The owner link opens the note panel; close it to use the page.
    await s.p.keyboard.press("Escape");
    ok(
      (await pillText(s.p))?.startsWith("Loki is watching") === true,
      "owner sees the watching pill",
    );
    await s.p.fill("#email", "me@example.com");
    await s.p.click("#email");
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    ok(s.reports.length === 1, `one report for one cause (got ${s.reports.length})`);
    const r = s.reports[0]?.suggestion ?? "";
    ok(r.includes("POST /shop/checkout → 500"), "the report names the failed request");
    ok(r.includes("button “Buy now”"), "the report carries the tap that led there");
    ok(!r.includes("me@example.com"), "what was typed never leaves the page");
    ok(!r.includes("token=secret"), "query strings never leave the page");
    ok(s.reports[0]?.ownerPass === "pass123", "the report is the owner's, so it starts a fix");
    ok(
      (await pillText(s.p))?.includes("Loki is fixing") === true,
      "the pill says it is being fixed",
    );
    ok(s.errors.length === 0, `no page errors (${s.errors.join("; ")})`);
    await s.close();
  }

  // ---- the launcher IS the status; the top bar only when it cannot be seen ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    const state = () =>
      s.p.evaluate(() => {
        const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
        const fab = r.querySelector(".fab") as HTMLElement;
        const bar = r.querySelector(".watch-pill") as HTMLElement;
        const bubble = r.querySelector(".fab-bubble") as HTMLElement;
        return {
          label: fab.innerText.replace(/\s+/g, " ").trim(),
          watching: fab.classList.contains("watching"),
          badge: (r.querySelector(".fab-badge") as HTMLElement).innerText,
          bar: getComputedStyle(bar).display !== "none",
          bubble: getComputedStyle(bubble).display !== "none" ? bubble.innerText : "",
        };
      });
    let st = await state();
    ok(
      st.label.startsWith("Loki · watching") && st.watching,
      `the owner's launcher says so (${st.label})`,
    );
    ok(!st.bar, "with the launcher showing it, the top bar stays off the site");
    await s.p.click("#find");
    await s.p.waitForTimeout(600);
    st = await state();
    ok(
      st.badge === "1" || st.badge === "2",
      `what Loki said while closed is counted (${st.badge})`,
    );
    ok(st.bubble.includes("/shop/sizes"), `…and shown beside the launcher (${st.bubble})`);
    await s.p.evaluate(() =>
      (
        document
          .getElementById("loki-feedback-host")!
          .shadowRoot!.querySelector(".fab") as HTMLElement
      ).click(),
    );
    await s.p.keyboard.press("Escape");
    st = await state();
    ok(st.badge === "", "opening Loki clears the count");
    // A site that hides the launcher must not hide that Loki is watching.
    await s.p.evaluate(() => document.documentElement.setAttribute("data-fc-place", "hidden"));
    await s.p.waitForTimeout(2600);
    st = await state();
    ok(st.bar, "launcher hidden by the site → the top bar says Loki is watching");
    ok(s.errors.length === 0, `no page errors (${s.errors.join("; ")})`);
    await s.close();
  }

  // ---- a button that does nothing, and one that works ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    for (let i = 0; i < 3; i++) await s.p.click("#ok");
    await s.p.waitForTimeout(400);
    ok(s.reports.length === 0, "a working button tapped three times is not reported");
    for (let i = 0; i < 3; i++) await s.p.click("#dead");
    await s.p.waitForTimeout(400);
    ok(s.reports.length === 1, `a dead button files one report (got ${s.reports.length})`);
    ok(
      (s.reports[0]?.suggestion ?? "").includes(
        "tapped button “Save” three times and nothing happened",
      ),
      "the report says which button did nothing",
    );
    // Loki said so in the conversation; Show on the bar opens it there.
    await clickPill(s.p, "Show");
    await s.p.waitForTimeout(300);
    const said = await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const m = Array.from(r.querySelectorAll(".msg.noticed")).find((x) =>
        (x as HTMLElement).innerText.includes("three times"),
      ) as HTMLElement | undefined;
      return {
        open: !!r.querySelector(".panel"),
        text: m?.innerText ?? "",
        fix: !!m?.querySelector(".change-send"),
      };
    });
    ok(said.open, "Show opens the conversation");
    ok(
      said.text.includes("three times and nothing happened") && said.text.includes("started a fix"),
      `Loki says what broke and that a fix is under way (${said.text})`,
    );
    ok(!said.fix, "an already-started fix offers no second Fix button");
    await s.close();
  }

  // ---- Review: Loki judges what the owner did, from evidence ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    await s.p.fill("#email", "me@example.com");
    // Tap the FILLED field: a tap on a field is recorded, its value never is.
    // (fill() alone types without a tap, which once made this check vacuous.)
    await s.p.click("#email");
    await s.p.click("#find");
    await s.p.waitForTimeout(500);
    ok(
      (await pillText(s.p))?.includes("/shop/sizes") === true,
      `the bar says what Loki noticed, in words (${await pillText(s.p)})`,
    );
    ok(s.reports.length === 0, "a 404 is a remark, not an automatic fix");
    ok(s.advice.length === 0, "speaking up costs no model call");
    await clickPill(s.p, "Show");
    await s.p.waitForTimeout(200);
    const remark = await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      const m = Array.from(r.querySelectorAll(".msg.noticed")).find((x) =>
        (x as HTMLElement).innerText.includes("/shop/sizes"),
      ) as HTMLElement | undefined;
      (m?.querySelector(".change-send") as HTMLElement | null)?.click();
      return m?.innerText ?? "";
    });
    ok(
      remark.includes("After you tapped button “Find a size”") &&
        remark.includes("found nothing there (404)"),
      `Loki says it in the conversation, naming the tap (${remark})`,
    );
    const card = await s.p.evaluate(
      () =>
        (
          document
            .getElementById("loki-feedback-host")!
            .shadowRoot!.querySelector(".sendcard textarea") as HTMLTextAreaElement | null
        )?.value ?? "",
    );
    ok(card.includes("Fix the request to /shop/sizes"), "Fix this opens the request, written out");
    await s.p.keyboard.press("Escape");

    // A trail survives a full page load: a multi-page site is one visit —
    // and what Loki already said, it does not say again.
    await s.p.reload();
    await s.p.waitForTimeout(3500);
    const repeats = await s.p.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("loki-thread:fcw_fixture") ?? "[]").filter(
          (i: { kind: string; text: string }) =>
            i.kind === "noticed" && i.text.includes("/shop/sizes"),
        ).length,
    );
    ok(repeats === 1, `a reload does not repeat a remark (${repeats})`);
    await clickPill(s.p, "Show");
    await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      (
        Array.from(r.querySelectorAll(".watchbtn")).find(
          (b) => (b as HTMLElement).innerText === "Review",
        ) as HTMLElement
      ).click();
    });
    await s.p.waitForTimeout(800);
    const a = s.advice[0];
    ok(s.advice.length === 1, `Review asks Loki once (got ${s.advice.length})`);
    const session = a?.session ?? "";
    ok(/^Review what I just did/.test(a?.question ?? ""), "Review asks for a review");
    ok(session.includes("tap button “Find a size”"), "the session carries the tap");
    ok(session.includes("GET /shop/sizes → 404"), "and what the page answered");
    ok(/page \/[\s\S]*page \//.test(session), "and both page loads — the trail survived reload");
    ok(
      session.includes("1 button(s)/link(s) have no name a screen reader can read"),
      `page checks: the unnamed icon button — and ONLY it, not the labelled footer link the browser skipped painting (${/\d+ button\(s\)[^\n]*/.exec(session)?.[0]})`,
    );
    const crowded = /(\d+) tap target\(s\) are under 24px and crowded[^\n]*/.exec(session);
    ok(!!crowded, "page checks: the two cramped 16px links are a finding");
    ok(
      !!crowded && !crowded[0].includes("Roomy"),
      `…a roomy 20px link is not — WCAG's spacing exception (${crowded?.[0]})`,
    );
    ok(session.includes("no alt text"), "page checks: the image without alt");
    ok(session.includes("failed to load"), "page checks: the broken image");
    ok(!session.includes("me@example.com"), "what was typed never leaves the page");
    ok(!session.includes("user=secret"), "query strings never leave the page");
    const shown = await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      return {
        reply: (
          Array.from(r.querySelectorAll(".convo .msg.from-loki")).pop() as HTMLElement | undefined
        )?.innerText,
        change: (r.querySelector(".convo .changes .change-text") as HTMLElement | null)?.innerText,
      };
    });
    ok(
      shown.reply?.includes("looking for a size") === true,
      "the review is shown in the conversation",
    );
    ok(shown.change?.includes("size chart") === true, "with its change one tap away");

    // Requesting that change carries the session's steps to the builder.
    await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      (r.querySelector(".convo .changes .change-send") as HTMLElement).click();
    });
    await s.p.waitForTimeout(200);
    const report = await s.p.evaluate(() => {
      const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
      return {
        text: (r.querySelector(".sendcard textarea") as HTMLTextAreaElement | null)?.value,
        diag: (r.querySelector(".sendcard .diag") as HTMLElement | null)?.style.display,
      };
    });
    ok(report.text?.includes("size chart") === true, "the change prefills the request");
    ok(report.diag === "block", "with the watched steps attached");
    // Loki's own panel opening is not the site's layout shift, and Loki's own
    // boot and page reading are not the site freezing.
    const after = await trailText(s.p);
    ok(!after.includes("jumped around"), `Loki's panel is not blamed for a shift (${after})`);
    ok(!after.includes("froze"), "nor Loki's own work for a freeze");
    ok(s.errors.length === 0, `no page errors (${s.errors.join("; ")})`);
    await s.close();
  }

  // ---- the site's own jank IS noticed (a detector that never fires reads as clean) ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    await s.p.click("#jank");
    await s.p.waitForTimeout(1600);
    const t = await trailText(s.p);
    ok(/after button “Load more” the page froze for \d+ms/.test(t), `a felt freeze (${t})`);
    ok(t.includes("content jumped around on this page"), "and the content pushed down");
    ok(s.reports.length === 0, "jank is a remark for Review, not an automatic fix");
    await s.close();
  }

  // ---- paused: says so, and records nothing ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    await s.p.keyboard.press("Escape");
    await clickPillButton(s.p);
    ok((await pillText(s.p))?.startsWith("Loki stopped watching") === true, "stopping is visible");
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    ok(s.reports.length === 0, "stopped, a failure files nothing");
    await clickPillButton(s.p); // leave it resumed for the next context
    await s.close();
  }

  // ---- Stop watching from the panel's header: nothing recorded, nothing said ----
  {
    const s = await open(browser, js, "#loki-owner=pass123");
    const header = (label: string) =>
      s.p.evaluate((label) => {
        const r = document.getElementById("loki-feedback-host")!.shadowRoot!;
        const b = Array.from(r.querySelectorAll(".watchbtn")).find(
          (x) =>
            (x as HTMLElement).innerText === label && (x as HTMLElement).style.display !== "none",
        ) as HTMLElement | undefined;
        b?.click();
        return !!b;
      }, label);
    ok(await header("Stop watching"), "the header offers Stop watching while Loki watches");
    await s.p.keyboard.press("Escape");
    await s.p.click("#find");
    await s.p.waitForTimeout(3200);
    const after = await s.p.evaluate(() => ({
      thread: sessionStorage.getItem("loki-thread:fcw_fixture") ?? "",
      trail: sessionStorage.getItem("loki-watch-trail:fcw_fixture") ?? "",
    }));
    ok(!after.thread.includes("noticed"), "stopped, Loki says nothing");
    ok(!after.trail.includes("Find a size"), "stopped, nothing is recorded");
    await clickPill(s.p, "Show");
    ok(await header("Watch again"), "and the header offers Watch again");
    ok((await pillText(s.p))?.startsWith("Loki is watching") === true, "which starts it again");
    await s.close();
  }

  // ---- a visitor: no pill, no recording ----
  {
    const s = await open(browser, js, "");
    ok((await pillText(s.p)) === null, "a visitor gets no pill");
    await s.p.click("#buy");
    await s.p.waitForTimeout(600);
    ok(s.reports.length === 0, "a visitor's failures are not reported automatically");
    await s.close();
  }

  await browser.close();
  console.log(`widget-watch-browser: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();
