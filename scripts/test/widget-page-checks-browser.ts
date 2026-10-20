// The page checks count what a person can see — and only once the page holds
// still. Reproduces the miscount the operator's phone hit on /voice
// (2026-10-20): "The page has no main title" and "The page has 2 main titles"
// from the same page, because it was measured while it swapped its setup
// screen (the top bar's h1 + the page's) for its speaking screen (none), and
// because a heading inside an aria-hidden or inert subtree still counted.
// Run: npx tsx scripts/test/widget-page-checks-browser.ts
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const ORIGIN = "http://checks.fixture";

/** One visible h1, and every way a heading can be in the DOM but not shown. */
const HIDDEN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Voice</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main><h1>Voice</h1>
<div aria-hidden="true"><h1>Decorative copy</h1></div>
<div inert><h1>Inert screen</h1></div>
<div hidden><h1>Hidden screen</h1></div>
<div style="display:none"><section><h1>Gone screen</h1></section></div>
<div style="visibility:hidden"><h1>Invisible screen</h1></div>
<h1 style="width:0;height:0;overflow:hidden;padding:0;margin:0;border:0;font-size:0"></h1>
</main>
<div id="loki-feedback-host"><h1>Loki's own light-DOM heading</h1></div>
<script>
  // Loki's panel lives in a shadow root on the host; its headings are its own.
  const host = document.getElementById("loki-feedback-host");
  host.attachShadow({ mode: "open" }).innerHTML = "<h1>Watching</h1><h1>Loki noticed</h1>";
</script></body></html>`;

/**
 * Loki's /voice on a phone: the top bar names the page with an h1 and so does
 * the setup screen. Start swaps to the speaking screen — the setup screen
 * fades for 400ms, the speaking screen arrives, and immersive mode hides the
 * top bar. Mid-swap there are two h1s; after it, none.
 */
const SWAP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Voice</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body.immersive header { display: none; } .fading { opacity: .2; transition: opacity .4s; }</style>
</head><body>
<header><h1>Voice</h1></header>
<main id="main"><div id="setup"><h1>Voice</h1><button id="start">Start</button></div></main>
<script>
  window.swap = () => {
    const setup = document.getElementById("setup");
    setup.classList.add("fading");
    const speaking = document.createElement("div");
    speaking.innerHTML = '<button aria-label="Interrupt and talk">●</button><p>Listening</p>';
    document.getElementById("main").append(speaking);
    let tick = 0;
    const t = setInterval(() => {
      speaking.querySelector("p").textContent = "Listening" + ".".repeat(++tick % 4);
      if (tick === 4) {
        clearInterval(t);
        setup.remove();
        document.body.classList.add("immersive");
      }
    }, 100);
  };
</script></body></html>`;

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
    stdin: {
      contents: `import { runPageChecks, settledPageChecks } from "./widget/page-checks";
        Object.assign(window, { runPageChecks, settledPageChecks });`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const js = out.outputFiles[0].text;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      body: path === "/swap" ? SWAP : HIDDEN,
      contentType: "text/html",
    });
  });
  const load = async (path: string) => {
    await p.goto(`${ORIGIN}${path}`);
    await p.addScriptTag({ content: js });
  };
  const headings = (checks: string[]) => checks.filter((c) => /main heading/.test(c));

  // ---- only what is rendered counts ----
  {
    await load("/hidden");
    const checks = await p.evaluate(() =>
      (window as unknown as { runPageChecks: () => string[] }).runPageChecks(),
    );
    ok(
      headings(checks).length === 0,
      `one visible h1 is one main heading — aria-hidden, inert, hidden, display:none, visibility:hidden, zero-size and Loki's own headings are not counted (got: ${headings(checks).join(" / ") || "none"})`,
    );
  }

  // ---- measured mid-swap, the page reads two ways ----
  await load("/swap");
  const naive = await p.evaluate(async () => {
    const w = window as unknown as { runPageChecks: () => string[]; swap: () => void };
    const before = w.runPageChecks();
    w.swap();
    await new Promise((r) => setTimeout(r, 150));
    const mid = w.runPageChecks();
    await new Promise((r) => setTimeout(r, 700));
    return { before, mid, after: w.runPageChecks() };
  });
  ok(
    headings(naive.mid).some((c) => /2 main headings/.test(c)),
    `reproduced: mid-swap the page reads "2 main headings" (got: ${headings(naive.mid).join(" / ") || "none"})`,
  );
  ok(
    headings(naive.after).some((c) => /no main heading/.test(c)),
    `reproduced: after the swap it reads "no main heading" (got: ${headings(naive.after).join(" / ") || "none"})`,
  );

  // ---- measured as Watch measures now: settled, twice, agreed ----
  await load("/swap");
  const settled = await p.evaluate(async () => {
    const w = window as unknown as {
      settledPageChecks: (
        d: Document,
        ours: (n: Node) => boolean,
        t: { quietMs: number; confirmMs: number; maxMs: number },
      ) => Promise<string[]>;
      swap: () => void;
    };
    const started = performance.now();
    w.swap();
    // Starts looking the moment the swap begins — the worst case.
    const checks = await w.settledPageChecks(document, () => false, {
      quietMs: 250,
      confirmMs: 200,
      maxMs: 4000,
    });
    return { checks, ms: performance.now() - started };
  });
  ok(
    headings(settled.checks).length === 1 && /no main heading/.test(headings(settled.checks)[0]),
    `settled, the speaking screen is said once, as it is: no main heading (got: ${headings(settled.checks).join(" / ") || "none"})`,
  );
  ok(settled.ms >= 400, `it waited for the swap to finish (${Math.round(settled.ms)}ms)`);

  // ---- a page that never holds still: only what two readings agree on ----
  await load("/swap");
  const restless = await p.evaluate(async () => {
    const w = window as unknown as {
      settledPageChecks: (
        d: Document,
        ours: (n: Node) => boolean,
        t: { quietMs: number; confirmMs: number; maxMs: number },
      ) => Promise<string[]>;
    };
    // Flip the page's title every 60ms, for ever: the settle wait gives up at
    // maxMs, and the two readings it takes may disagree.
    let on = true;
    setInterval(() => {
      document.querySelector("header")!.style.display = (on = !on) ? "" : "none";
    }, 60);
    return w.settledPageChecks(document, () => false, {
      quietMs: 200,
      confirmMs: 90,
      maxMs: 300,
    });
  });
  ok(
    headings(restless).length <= 1,
    `a restless page is never said two ways at once (got: ${headings(restless).join(" / ") || "none"})`,
  );

  // ---- Loki's own changes do not count as the page changing ----
  await load("/hidden");
  const quiet = await p.evaluate(async () => {
    const w = window as unknown as {
      settledPageChecks: (
        d: Document,
        ours: (n: Node) => boolean,
        t: { quietMs: number; confirmMs: number; maxMs: number },
      ) => Promise<string[]>;
    };
    const host = document.getElementById("loki-feedback-host")!;
    const t = setInterval(() => host.append(document.createElement("span")), 50);
    const started = performance.now();
    await w.settledPageChecks(document, (n) => host.contains(n), {
      quietMs: 200,
      confirmMs: 50,
      maxMs: 3000,
    });
    clearInterval(t);
    return performance.now() - started;
  });
  ok(quiet < 1500, `Loki's own panel moving does not hold the look up (${Math.round(quiet)}ms)`);

  ok(errors.length === 0, `no page errors (${errors.join("; ")})`);
  await ctx.close();
  await browser.close();
  console.log(`widget-page-checks-browser: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
