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

    // 1b. REGRESSION (loki /sign-in at 390): the bottom band is all buttons, and
    //     the first slot up the edge that holds no control is a centred line of
    //     words ("or sign in"). Words are not free: the launcher must climb past
    //     them to the empty space above, and never sit on the line.
    {
      const html = page(
        `<h1 style="text-align:center;margin:24px 0 0">Welcome back</h1>
         <p style="text-align:center;margin:8px 0 0">Sign in to your account.</p>
         <div style="height:160px"></div>
         <p id="divider" style="text-align:center;margin:0 0 8px">or sign in with your email address instead</p>
         <div style="background:#f4f4f4;padding:16px;min-height:100vh">
           ${["OrangeCat", "GitHub", "Google", "X", "Apple", "Microsoft", "Slack", "Discord"]
             .map(
               (t) =>
                 `<button style="display:block;width:100%;height:48px;margin:0 0 12px">Continue with ${t}</button>`,
             )
             .join("")}
           <input style="display:block;width:100%;height:48px;margin:0 0 12px" placeholder="Email">
           <input style="display:block;width:100%;height:48px;margin:0 0 12px" placeholder="Password">
           <button id="submit" style="display:block;width:100%;height:48px">Sign in</button>
         </div>`,
      );
      const { p, close } = await open(browser, html, 390, 844, js);
      const f = await fab(p);
      const divider = await box(p, "#divider");
      ok(!!f && f.visible, "sign-in: launcher still shown (empty space exists above the words)");
      ok(!!f && !overlap(f, divider), "sign-in: launcher does NOT sit on the line of words");
      ok(await clickReaches(p, "button"), "sign-in: the first provider button receives its click");
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

    // 4. REGRESSION (substrata, 2026-10-17): a host's own fixed Ask/chat
    //    button in our corner. The rule was "stack above it with a gap", and
    //    that drew two assistants as one tower at 390px and floated ours 300px
    //    up the edge at 1280px. The corner is the host's: take the other one.
    for (const [w, hgt] of [
      [390, 760],
      [1440, 900],
    ] as const) {
      const html = page(
        `${filler}<div style="position:fixed;right:20px;bottom:84px"><button id="ask" style="width:64px;height:48px;border-radius:24px">Ask</button></div>
         <nav id="tabbar" style="position:fixed;left:0;right:0;bottom:0;height:64px;background:#eee;display:flex">
           ${["Home", "Map", "More"].map((t) => `<a href="#${t}" style="flex:1;display:grid;place-items:center">${t}</a>`).join("")}</nav>`,
      );
      const { p, close } = await open(browser, html, w, hgt, js);
      const f = await fab(p);
      ok(await clickReaches(p, "#ask"), `ask button ${w}: receives its click`);
      ok(!!f && f.visible && f.right <= w / 2, `ask button ${w}: launcher takes the other corner`);
      ok(
        !!f && f.bottom >= hgt - 64 - 272 - 48,
        `ask button ${w}: …and stays in it, not halfway up the page`,
      );
      ok(!!f && !overlap(f, await box(p, "#tabbar")), `ask button ${w}: off the tab bar`);
      await close();
    }

    // 4b. Both corners hold the host's buttons: the edge tab, never a tower.
    {
      const btn = (side: string, id: string) =>
        `<button id="${id}" style="position:fixed;${side}:20px;bottom:20px;width:60px;height:60px">${id}</button>`;
      const html = page(`${filler}${btn("right", "ask")}${btn("left", "help")}`);
      const { p, close } = await open(browser, html, 390, 844, js);
      const f = await fab(p);
      ok(!!f && f.visible && f.right >= 389 && f.right - f.left <= 32, "two floats: the edge tab");
      ok(await clickReaches(p, "#ask"), "two floats: Ask receives its click");
      ok(await clickReaches(p, "#help"), "two floats: Help receives its click");
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

    // 7b. The Terminal's contract (loki#1037): the page hides the launcher with
    //     data-fc-place="hidden" and opens the panel from its own header via
    //     Loki.report(). The panel must open without a launcher, and closing it
    //     must not bring the launcher back over the terminal.
    {
      const { p, close } = await open(browser, page(filler), 390, 844, js);
      await p.evaluate(() => {
        const pane = document.createElement("main");
        pane.setAttribute("data-fc-place", "hidden");
        pane.textContent = "terminal";
        document.body.prepend(pane);
      });
      await settle(p);
      ok((await fab(p))?.visible === false, "terminal page: launcher hidden");
      const panelOpen = () =>
        p.evaluate(() => {
          const panel = document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelector(".panel");
          return !!panel && panel.getClientRects().length > 0;
        });
      await p.evaluate(() => (window as unknown as { Loki: { report(): void } }).Loki.report());
      await settle(p);
      ok(await panelOpen(), "terminal page: Loki.report() opens the panel without a launcher");
      await p.evaluate(() =>
        (
          document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelector('[aria-label="Close"]') as HTMLButtonElement | null
        )?.click(),
      );
      await settle(p);
      ok(!(await panelOpen()), "terminal page: the panel closes");
      ok(
        (await fab(p))?.visible === false,
        "terminal page: closing the panel keeps the launcher hidden",
      );
      await close();
    }

    // 8. A sheet mounted AFTER load (no resize, no navigation): the launcher
    //    does NOT jump on the mutation (G, 2026-10-22: "it jumps around") —
    //    it re-checks on the next route change, which is when a new screen
    //    actually arrives in an SPA.
    {
      const { p, close } = await open(browser, page(filler), 390, 844, js);
      await p.waitForTimeout(1500); // past the 2.5s load re-check
      const before = await fab(p);
      await p.evaluate(() => {
        const s = document.createElement("section");
        s.id = "late";
        s.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;height:40vh;background:#fff;overflow-y:auto";
        s.innerHTML = Array.from({ length: 30 }, (_, i) => `<p>Late row ${i}</p>`).join("");
        document.body.append(s);
      });
      await settle(p);
      const still = await fab(p);
      ok(
        !!before && !!still && before.top === still.top && before.left === still.left,
        "late-mounted sheet: launcher stays put (no mutation-driven jump)",
      );
      await p.evaluate(() => history.pushState(null, "", "/next"));
      await p.waitForTimeout(2800);
      const f = await fab(p);
      ok(
        !!f && f.visible && !overlap(f, await box(p, "#late")),
        "late-mounted sheet: launcher moves off it on the next route change",
      );
      await close();
    }

    // 8b. Scrolling never moves or fades the launcher.
    {
      const html = page(
        `${filler}${filler}<button id="mid" style="position:absolute;right:0;top:1400px;width:200px;height:200px">mid</button>`,
      );
      const { p, close } = await open(browser, html, 390, 844, js);
      const before = await fab(p);
      for (const y of [400, 900, 1300]) {
        await p.evaluate((yy) => window.scrollTo(0, yy), y);
        await p.waitForTimeout(150);
        const op = await p.evaluate(() => {
          const el = document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelector(".fab");
          return el ? Number(getComputedStyle(el).opacity) : 0;
        });
        ok(op === 1, `scroll ${y}: launcher fully opaque`);
      }
      await settle(p);
      const after = await fab(p);
      ok(
        !!before && !!after && before.top === after.top && before.left === after.left,
        "scroll: launcher did not move",
      );
      await close();
    }

    // 8c. Drag: a tap still opens; a press-and-move moves it, snaps it to the
    //     nearest side edge at the dropped height, does not open the panel,
    //     and the spot survives a reload. No "Move to other corner" item.
    {
      const { p, close } = await open(browser, page(filler), 1440, 900, js);
      const panelOpen = () =>
        p.evaluate(() => {
          const panel = document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelector(".panel");
          return !!panel && panel.getClientRects().length > 0;
        });
      const start = (await fab(p))!;
      const cx = (start.left + start.right) / 2;
      const cy = (start.top + start.bottom) / 2;
      await p.mouse.move(cx, cy);
      await p.mouse.down();
      await p.mouse.move(cx - 3, cy - 2);
      await p.mouse.up();
      ok(await panelOpen(), "drag: a tap (under the threshold) still opens Loki");
      await p.evaluate(() =>
        (
          document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelector('[aria-label="Close"]') as HTMLButtonElement | null
        )?.click(),
      );
      await p.waitForTimeout(300);
      await p.mouse.move(cx, cy);
      await p.mouse.down();
      for (let i = 1; i <= 10; i++) await p.mouse.move(cx - i * 100, cy - i * 40);
      await p.mouse.up();
      await p.waitForTimeout(400);
      ok(!(await panelOpen()), "drag: the drop does not open Loki");
      const dropped = (await fab(p))!;
      ok(Math.round(dropped.left) === 16, `drag: snapped to the left edge (left=${dropped.left})`);
      ok(
        Math.abs(dropped.top - (start.top - 400)) < 3,
        `drag: kept the dropped height (top=${dropped.top}, want≈${start.top - 400})`,
      );
      await settle(p);
      await p.setViewportSize({ width: 1400, height: 900 });
      await settle(p);
      const afterResize = (await fab(p))!;
      ok(
        Math.round(afterResize.left) === 16 && Math.abs(afterResize.top - dropped.top) < 3,
        "drag: a resize does not move a dragged launcher",
      );
      await p.reload();
      await p.waitForFunction(() =>
        Boolean(document.getElementById("loki-feedback-host")?.shadowRoot?.querySelector(".fab")),
      );
      await settle(p);
      const reloaded = (await fab(p))!;
      ok(
        Math.round(reloaded.left) === 16 && Math.abs(reloaded.top - dropped.top) < 3,
        "drag: the spot is remembered on this site after a reload",
      );
      const items = await p.evaluate(() =>
        Array.from(
          document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelectorAll(".fabmenu-item") ?? [],
        ).map((e) => e.textContent),
      );
      ok(!items.includes("Move to other corner"), "drag: no 'Move to other corner' menu item");
      await close();
    }

    // 8d. Minimize: the long-press / right-click menu folds the pill into the
    //     slim edge tab where the person left it; the tab opens Loki, survives
    //     a reload, keeps its own menu with Expand, and Expand brings the
    //     button back. A pill left over the text someone is reading was the
    //     owner's complaint (2026-10-22: "kind of disturbing").
    {
      const { p, close } = await open(browser, page(filler), 390, 844, js);
      const menuItems = () =>
        p.evaluate(() =>
          Array.from(
            document
              .getElementById("loki-feedback-host")
              ?.shadowRoot?.querySelectorAll(".fabmenu-item") ?? [],
          )
            .filter((e) => getComputedStyle(e).display !== "none")
            .map((e) => e.textContent),
        );
      const press = async (label: string) =>
        p.evaluate((label) => {
          const item = Array.from(
            document
              .getElementById("loki-feedback-host")!
              .shadowRoot!.querySelectorAll(".fabmenu-item"),
          ).find((e) => e.textContent === label) as HTMLElement | undefined;
          item?.click();
        }, label);
      const holdMenu = async () => {
        const f = (await fab(p))!;
        await p.mouse.click((f.left + f.right) / 2, (f.top + f.bottom) / 2, { button: "right" });
        await p.waitForTimeout(200);
      };
      const isTab = () =>
        p.evaluate(() =>
          document
            .getElementById("loki-feedback-host")
            ?.shadowRoot?.querySelector(".fab")
            ?.classList.contains("tab"),
        );

      const full = (await fab(p))!;
      await holdMenu();
      const first = await menuItems();
      ok(first[0] === "Minimize", `minimize: the menu leads with Minimize (${first.join(" | ")})`);
      ok(first.includes("Hide on this site"), "minimize: Hide on this site is still there");
      await press("Minimize");
      await p.waitForTimeout(300);
      const small = (await fab(p))!;
      ok(!!(await isTab()), "minimize: the launcher is the edge tab");
      ok(
        small.right >= 389 && small.right - small.left <= 32,
        `minimize: flush right and slim (w=${small.right - small.left})`,
      );
      ok(
        small.right - small.left < full.right - full.left,
        "minimize: smaller than the button was",
      );
      ok(small.visible, "minimize: still on screen, never gone");
      await p.reload();
      await p.waitForFunction(() =>
        Boolean(document.getElementById("loki-feedback-host")?.shadowRoot?.querySelector(".fab")),
      );
      await settle(p);
      ok(!!(await isTab()), "minimize: remembered on this site after a reload");

      await holdMenu();
      const second = await menuItems();
      ok(second[0] === "Expand", `minimize: the tab's menu offers Expand (${second.join(" | ")})`);
      await press("Expand");
      await p.waitForTimeout(300);
      ok(!(await isTab()), "minimize: Expand brings the button back");
      await p.reload();
      await p.waitForFunction(() =>
        Boolean(document.getElementById("loki-feedback-host")?.shadowRoot?.querySelector(".fab")),
      );
      await settle(p);
      ok(!(await isTab()), "minimize: Expand is remembered too");
      await close();
    }

    // 9. Every corner slot is a control: the launcher becomes the edge tab —
    //    narrow, flush against the side — instead of vanishing. A launcher
    //    that is there on some pages and gone on others reads as broken.
    {
      const grid = Array.from(
        { length: 400 },
        (_, i) => `<button style="width:48px;height:48px;margin:0">${i}</button>`,
      ).join("");
      const html = page(
        `<div style="position:fixed;inset:0;display:flex;flex-wrap:wrap;overflow:hidden">${grid}</div>`,
      );
      const { p, close } = await open(browser, html, 390, 844, js);
      const f = await fab(p);
      ok(!!f && f.visible, "wall of controls: the launcher is still on screen");
      ok(!!f && f.right >= 389 && f.right - f.left <= 32, "…as the edge tab, flush right");
      await close();
    }

    // 10. data-fc-place="tab" on a region (the Terminal, /loki): edge tab while
    //     the region is rendered, the corner button once it is gone.
    {
      const { p, close } = await open(browser, page(filler), 1440, 900, js);
      await p.evaluate(() => {
        const pane = document.createElement("main");
        pane.id = "pane";
        pane.setAttribute("data-fc-place", "tab");
        pane.textContent = "terminal";
        document.body.prepend(pane);
      });
      await settle(p);
      let f = await fab(p);
      ok(
        !!f && f.visible && f.right >= 1439 && f.right - f.left <= 32,
        'data-fc-place="tab": edge tab',
      );
      ok(!!f && f.top > 200 && f.bottom < 700, "…at the middle of the edge, where it always is");
      await p.evaluate(() => document.getElementById("pane")?.remove());
      await settle(p);
      f = await fab(p);
      ok(!!f && f.visible && f.bottom > 800, "region gone: the corner button is back");
      await close();
    }

    // 11. The host's own switch: Loki.hide() / Loki.show() / Loki.hidden, and
    //     the event a host's toggle listens to.
    {
      const { p, close } = await open(browser, page(filler), 1440, 900, js);
      const events = await p.evaluate(async () => {
        const seen: boolean[] = [];
        window.addEventListener("loki:visibility", (e) =>
          seen.push((e as CustomEvent<{ hidden: boolean }>).detail.hidden),
        );
        const api = (window as unknown as { Loki: { hide(): void; show(): void; hidden: boolean } })
          .Loki;
        api.hide();
        const afterHide = api.hidden;
        await new Promise((r) => setTimeout(r, 50));
        return { seen, afterHide };
      });
      ok(events.afterHide === true, "Loki.hide(): hidden is true");
      ok(events.seen.join() === "true", "Loki.hide(): one loki:visibility event, hidden");
      ok((await fab(p))?.visible === false, "Loki.hide(): the launcher is gone");
      await p.evaluate(() => (window as unknown as { Loki: { show(): void } }).Loki.show());
      await settle(p);
      ok((await fab(p))?.visible === true, "Loki.show(): the launcher is back");
      ok(
        await p.evaluate(
          () => (window as unknown as { Loki: { hidden: boolean } }).Loki.hidden === false,
        ),
        "Loki.show(): hidden is false",
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
