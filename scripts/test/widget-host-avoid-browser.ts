// The launcher must never sit on the host page's own UI — proven in a real
// browser, because the failure modes are layout ones no pure test can see.
//
// Each fixture is a host page the launcher has actually been wrong on, or one
// the host contract (data-fc-avoid / data-fc-place) promises to handle. The
// bundle under test is built from widget/main.ts exactly as `build:widget`
// does, and served with a mocked boot endpoint, so nothing touches the network.
//
// Mutation-proven: pointing WIDGET_JS at the pre-fix bundle (origin/main
// before this test existed) fails the sheet, avoid, place, late-mount and
// all-blocked fixtures. Run: npx tsx scripts/test/widget-host-avoid-browser.ts
//
// Needs Chromium. CI installs it (ci.yml); a machine without it skips with a
// reason — except under CI, where a missing browser is a failure, because a
// gate that silently skips everywhere it runs is no gate.
import { readFileSync } from "fs";
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

async function widgetBundle(): Promise<string> {
  if (process.env.WIDGET_JS) return readFileSync(process.env.WIDGET_JS, "utf8");
  const out = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

const page = (body: string, htmlAttrs = "") => `<!doctype html>
<html ${htmlAttrs}><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;font:16px/1.4 sans-serif} p{margin:0 0 12px}</style></head>
<body>${body}
<script src="${ORIGIN}/widget.js" data-fc-project="fcw_fixture" async></script>
</body></html>`;

const filler = Array.from({ length: 40 }, (_, i) => `<p>Row ${i} of body text.</p>`).join("");

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function open(browser: Browser, html: string, width: number, height: number, js: string) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  await p.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/widget.js") {
      return route.fulfill({ body: js, contentType: "text/javascript" });
    }
    if (url.pathname === "/api/widget-boot") {
      return route.fulfill({
        body: JSON.stringify({
          active: true,
          placement: { corner: "bottom-right", offsetX: 16, offsetY: 16, autoAvoid: true },
          theme: PALETTE.widget,
        }),
        contentType: "application/json",
      });
    }
    return route.fulfill({ body: html, contentType: "text/html" });
  });
  await p.goto(`${ORIGIN}/`);
  await p.waitForFunction(() =>
    Boolean(document.getElementById("loki-feedback-host")?.shadowRoot?.querySelector(".fab")),
  );
  await settle(p);
  return { p, close: () => ctx.close() };
}

/** Past the widget's 800ms re-check and one mutation-throttle window. */
const settle = (p: Page) => p.waitForTimeout(1300);

async function fab(p: Page): Promise<(Box & { visible: boolean }) | null> {
  return p.evaluate(() => {
    const el = document.getElementById("loki-feedback-host")?.shadowRoot?.querySelector(".fab");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      visible: cs.visibility !== "hidden" && cs.display !== "none",
    };
  });
}

async function box(p: Page, sel: string): Promise<Box> {
  return p.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

const overlap = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Does a click at the centre of `sel` reach `sel`? The user-visible truth. */
async function clickReaches(p: Page, sel: string): Promise<boolean> {
  return p.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return hit === el || el.contains(hit);
  });
}

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
  const js = await widgetBundle();

  try {
    // 1. Nothing in the corner: the launcher stays exactly where configured.
    {
      const { p, close } = await open(browser, page(filler), 1440, 900, js);
      const f = await fab(p);
      ok(
        !!f && f.visible && Math.round(1440 - f.right) === 16 && Math.round(900 - f.bottom) === 16,
        "clean page: launcher sits at its configured bottom-right 16/16",
      );
      await close();
    }

    // 2. REGRESSION (substrata /atlas at 390): a full-width bottom sheet with a
    //    scrolling body and a control in its corner. The old engine ignored any
    //    layer wider than 90% of the viewport and parked on the sheet's text.
    {
      const html = page(
        `${filler}<nav id="tabbar" style="position:fixed;left:0;right:0;bottom:0;height:64px;background:#eee;display:flex">
          ${["Bottlenecks", "Map", "Markets", "News", "More"]
            .map((t) => `<a href="#${t}" style="flex:1;display:grid;place-items:center">${t}</a>`)
            .join("")}</nav>
         <section id="sheet" style="position:fixed;left:0;right:0;bottom:64px;height:46vh;background:#fff;border-top:1px solid #ccc;overflow-y:auto">
           ${filler}<button id="sheet-btn" style="position:absolute;right:8px;top:8px;width:44px;height:44px">×</button>
         </section>`,
      );
      const { p, close } = await open(browser, html, 390, 844, js);
      const f = await fab(p);
      const sheet = await box(p, "#sheet");
      ok(!!f && f.visible, "sheet: launcher still shown (a free slot exists above the sheet)");
      ok(!!f && !overlap(f, sheet), "sheet: launcher does NOT overlap the bottom sheet");
      ok(!!f && !overlap(f, await box(p, "#tabbar")), "sheet: nor the tab bar under it");
      ok(await clickReaches(p, "#sheet-btn"), "sheet: the sheet's own button receives its click");
      ok(
        await clickReaches(p, "#tabbar a:last-child"),
        "sheet: the tab bar's last tab receives its click",
      );
      await close();
    }

    // 2b. The real /atlas shape: everything above the sheet is a pannable map
    //     (a focusable control), so no slot is free. A corner of a huge
    //     control costs less than covering the sheet's content.
    {
      const html = page(
        `<div id="map" tabindex="0" style="position:fixed;inset:0;background:#cde;cursor:grab"></div>
         <section id="sheet" style="position:fixed;left:0;right:0;bottom:0;height:50vh;background:#fff;overflow-y:auto">${filler}</section>`,
      );
      const { p, close } = await open(browser, html, 390, 844, js);
      const f = await fab(p);
      ok(
        !!f && f.visible && !overlap(f, await box(p, "#sheet")),
        "map + sheet: launcher sits on the map, not the sheet",
      );
      await close();
    }

    // 3. REGRESSION (OrangeCat /messages, 18 days): an in-flow composer whose
    //    Send button sits exactly in the corner at desktop width.
    {
      const html = page(
        `${filler}<form style="position:fixed;left:0;right:0;bottom:0;padding:12px 16px;background:#fafafa;display:flex;gap:8px">
           <input style="flex:1;height:40px" placeholder="Message"><button id="send" style="width:72px;height:40px">Send</button></form>`,
      );
      const { p, close } = await open(browser, html, 1440, 900, js);
      ok(await clickReaches(p, "#send"), "composer: Send receives its click at 1440");
      const f = await fab(p);
      ok(
        !!f && f.visible && !overlap(f, await box(p, "#send")),
        "composer: launcher clear of Send",
      );
      await close();
    }

    // 4. A host's own fixed Ask/chat launcher in the same corner: stack above
    //    it with a visible gap, never on it.
    {
      const html = page(
        `${filler}<button id="ask" style="position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:30px">Ask</button>`,
      );
      const { p, close } = await open(browser, html, 1440, 900, js);
      const f = await fab(p);
      const ask = await box(p, "#ask");
      ok(await clickReaches(p, "#ask"), "ask button: receives its click");
      ok(
        !!f && f.visible && f.bottom <= ask.top - 8,
        "ask button: launcher stacks above it with a gap",
      );
      await close();
    }

    // 5. data-fc-avoid: something heuristics cannot see (a pointer-events:none
    //    overlay a host still wants readable).
    {
      const html = page(
        `${filler}<div id="legend" data-fc-avoid style="position:absolute;right:0;bottom:0;width:220px;height:220px;pointer-events:none;background:rgba(0,0,0,.05)">Legend</div>`,
      );
      const { p, close } = await open(browser, html, 1440, 900, js);
      const f = await fab(p);
      ok(
        !!f && f.visible && !overlap(f, await box(p, "#legend")),
        "data-fc-avoid: never overlapped",
      );
      await close();
    }

    // 6. data-fc-place on <html>: the host names the side.
    {
      const { p, close } = await open(browser, page(filler, 'data-fc-place="left"'), 1440, 900, js);
      const f = await fab(p);
      ok(!!f && f.visible && f.left < 100, 'data-fc-place="left" on <html>: launcher on the left');
      await close();
    }

    // 7. data-fc-place="hidden" on a page region, mounted and unmounted at
    //    runtime (SPA route): hidden while present, back when gone — which
    //    also proves the DOM-mutation re-check.
    {
      const { p, close } = await open(browser, page(filler), 1440, 900, js);
      await p.evaluate(() => {
        const region = document.createElement("main");
        region.id = "checkout";
        region.setAttribute("data-fc-place", "hidden");
        region.textContent = "Checkout";
        document.body.prepend(region);
      });
      await settle(p);
      ok((await fab(p))?.visible === false, 'data-fc-place="hidden" region: launcher hidden');
      await p.evaluate(() => document.getElementById("checkout")?.remove());
      await settle(p);
      ok((await fab(p))?.visible === true, "region removed: launcher back without a reload");
      await close();
    }

    // 8. A sheet mounted AFTER load (no resize, no navigation): the launcher
    //    must move off it on the mutation alone.
    {
      const { p, close } = await open(browser, page(filler), 390, 844, js);
      await p.evaluate(() => {
        const s = document.createElement("section");
        s.id = "late";
        s.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;height:40vh;background:#fff;overflow-y:auto";
        s.innerHTML = Array.from({ length: 30 }, (_, i) => `<p>Late row ${i}</p>`).join("");
        document.body.append(s);
      });
      await settle(p);
      const f = await fab(p);
      ok(
        !!f && f.visible && !overlap(f, await box(p, "#late")),
        "late-mounted sheet: launcher moves off it",
      );
      await close();
    }

    // 9. Every slot is a control: hide rather than eat a click.
    {
      const grid = Array.from(
        { length: 400 },
        (_, i) => `<button style="width:48px;height:48px;margin:0">${i}</button>`,
      ).join("");
      const html = page(
        `<div style="position:fixed;inset:0;display:flex;flex-wrap:wrap;overflow:hidden">${grid}</div>`,
      );
      const { p, close } = await open(browser, html, 390, 844, js);
      ok(
        (await fab(p))?.visible === false,
        "wall of controls: launcher hides instead of covering one",
      );
      await close();
    }
  } finally {
    await browser.close();
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
