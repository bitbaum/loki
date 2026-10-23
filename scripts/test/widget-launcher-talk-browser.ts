// The owner's microphone is a segment of the launcher, never a second thing:
// inside the pill's own rectangle, grabbed like the pill, and absent whenever
// the pill is not drawn by the widget (a host-drawn launcher on Loki's own
// pages, the edge tab). On 2026-10-23 a lone microphone floated over the phone's
// tab bar, could not be moved, and had no launcher beside it — it had measured
// a launcher that was visibility:hidden.
// Run: npx tsx scripts/test/widget-launcher-talk-browser.ts
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

type Box = { x: number; y: number; width: number; height: number };

async function main() {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { createLauncher } from './widget/launcher';
        import { createQuickTalk } from './widget/quick-talk';
        import { buildShadowCSS } from './widget/theme';
        import { PALETTE } from './src/lib/palette';
        const host = document.createElement('div');
        host.id = 'loki-feedback-host';
        document.body.append(host);
        const root = host.attachShadow({mode:'open'});
        const style = document.createElement('style');
        style.textContent = buildShadowCSS(PALETTE.widget);
        root.append(style);
        const launcher = createLauncher({root,host,token:'fixture',
          getPlacement:()=>({corner:'bottom-right',offsetX:16,offsetY:16,autoAvoid:true}),
          getVisitorOverride:()=>null,setVisitorOverride:()=>{},
          onOpen:()=>{window.opened=(window.opened||0)+1},onHide:()=>{}});
        launcher.setOwnerStatus({watching:true,unread:0});
        window.wanted = true;
        window.talks = 0;
        window.quick = createQuickTalk({root,fab:launcher.fab,launcher,
          wanted:()=>window.wanted,onTalk:()=>{window.talks++}});
        window.fixture = launcher;
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ launcher talk skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<style>body{margin:0;font:16px sans-serif}</style>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const root = page.locator("#loki-feedback-host");
    const fab = root.locator(".fab");
    const mic = root.locator(".fab-talk");
    const box = async (l: typeof fab) => (await l.boundingBox()) as Box;
    const inside = (inner: Box, outer: Box) =>
      inner.x >= outer.x - 0.5 &&
      inner.y >= outer.y - 0.5 &&
      inner.x + inner.width <= outer.x + outer.width + 0.5 &&
      inner.y + inner.height <= outer.y + outer.height + 0.5;

    // 1. One thing: the microphone lies inside the pill, a thumb-sized target,
    //    and the pill stays on screen with it in.
    await mic.waitFor({ state: "visible" });
    let [pill, m] = [await box(fab), await box(mic)];
    assert.ok(inside(m, pill), "the microphone sits inside the launcher's own rectangle");
    assert.ok(m.width >= 44 && m.height >= 44, "a thumb-sized target");
    assert.ok(
      pill.x >= 0 && pill.x + pill.width <= 390,
      "the pill, microphone included, is on screen",
    );
    assert.equal((await root.locator(".fab-label").innerText()).trim(), "Watching");

    // 2. A tap on the microphone talks (once) and does not open the panel.
    await mic.click();
    assert.equal(
      await page.evaluate("window.talks"),
      1,
      "one tap on the microphone starts talking",
    );
    assert.equal(await page.evaluate("window.opened || 0"), 0, "…and does not open the panel");
    await page.evaluate("window.fixture.reposition(); window.quick.sync()");
    await mic.waitFor({ state: "visible" });

    // 3. It is grabbed like the pill: drag from the microphone and both move
    //    together, and the drop is not a tap.
    pill = await box(fab);
    m = await box(mic);
    const from = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 120, from.y - 220, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(700); // the snap transition, and the microphone following it
    const [pill2, m2] = [await box(fab), await box(mic)];
    assert.ok(pill2.y < pill.y - 100, "dragging the microphone moved the launcher");
    assert.ok(inside(m2, pill2), "the microphone arrived with it");
    assert.ok(pill2.x >= 0 && pill2.x + pill2.width <= 390, "and it is still wholly on screen");
    assert.equal(await page.evaluate("window.talks"), 1, "the drop did not start talking");

    // 4. A launcher the host draws (Loki's own top bar) means NO microphone —
    //    never a microphone alone.
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "hostlauncher";
      b.setAttribute("data-fc-place", "host");
      b.textContent = "L";
      b.style.cssText = "position:fixed;top:4px;right:4px;width:40px;height:40px";
      document.body.append(b);
    });
    await page.waitForFunction(() =>
      document.getElementById("loki-feedback-host")!.shadowRoot!.querySelector(".fab-talk")
        ? getComputedStyle(
            document.getElementById("loki-feedback-host")!.shadowRoot!.querySelector(".fab-talk")!,
          ).display === "none"
        : true,
    );
    assert.equal(await mic.isVisible(), false, "a host-drawn launcher leaves no microphone behind");
    assert.equal(await fab.isVisible(), false, "and the widget draws no pill of its own");
    await page.evaluate(() => document.getElementById("hostlauncher")!.remove());
    await mic.waitFor({ state: "visible" });

    // 5. Not wanted (a recording, the panel open) → the pill is back to its own
    //    width and the microphone is gone.
    const withMic = (await box(fab)).width;
    await page.evaluate("window.wanted = false; window.quick.sync()");
    await mic.waitFor({ state: "hidden" });
    assert.ok((await box(fab)).width < withMic, "the pill gives the room back");
    await page.evaluate("window.wanted = true; window.quick.sync()");
    await mic.waitFor({ state: "visible" });

    assert.deepEqual(errors, [], "no page errors");
    console.log("✓ the microphone is one segment of the launcher, never alone");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
