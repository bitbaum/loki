// Real launcher, scanner and styles: reproduce the wide owner control that
// covered the mobile project page while its main button alone appeared clear.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

async function main() {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { createLauncher } from './widget/launcher';
        import { buildShadowCSS } from './widget/theme';
        import { PALETTE } from './src/lib/palette';
        const host = document.createElement('div');
        host.id = 'loki-feedback-host';
        document.body.append(host);
        const root = host.attachShadow({mode:'open'});
        const style = document.createElement('style');
        style.textContent = buildShadowCSS(PALETTE.widget);
        root.append(style);
        window.fixture = createLauncher({root,host,token:'fixture',
          getPlacement:()=>({corner:'bottom-right',offsetX:16,offsetY:16,autoAvoid:true}),
          getVisitorOverride:()=>null,setVisitorOverride:()=>{},
          onOpen:()=>window.opened=true,onHide:()=>{},onPoint:()=>window.pointed=true});
        window.fixture.setOwnerStatus({watching:true,unread:12});
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
    console.log("↷ owner placement skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<style>body{margin:0;font:16px sans-serif}</style>
      <button id="action" style="position:fixed;top:0;left:0;width:20px;height:24px">Go</button>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const root = page.locator("#loki-feedback-host");
    const parts = [root.locator(".fab"), root.locator(".fab-point"), root.locator(".fab-badge")];
    // Put a small action under the target's outer half, beyond the main
    // button's existing safety gap. Font widths cannot make this vacuous.
    await page.evaluate(() => {
      const point = document
        .getElementById("loki-feedback-host")!
        .shadowRoot!.querySelector(".fab-point")!;
      const rect = point.getBoundingClientRect();
      const action = document.getElementById("action")!;
      action.style.left = `${rect.left + 2}px`;
      action.style.top = `${rect.top + 8}px`;
    });
    await page.evaluate("window.fixture.reposition()");
    const action = (await page.locator("#action").boundingBox())!;
    for (const part of parts) {
      const rect = await part.boundingBox();
      if (!rect) continue;
      assert.ok(
        rect.x + rect.width <= action.x ||
          rect.x >= action.x + action.width ||
          rect.y + rect.height <= action.y ||
          rect.y >= action.y + action.height,
        "both launcher halves and badge must clear the host action",
      );
    }
    assert.equal(await root.locator(".fab-badge").innerText(), "9+");
    await root.locator(".fab-point").click();
    assert.equal(await page.evaluate("window.pointed"), true);

    // A dense screen has no gap for a wide pill. Keep one small, labelled
    // access point and the unread count, rather than parking on the prose.
    await page.evaluate(() => {
      const wall = document.createElement("div");
      wall.id = "wall";
      wall.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column";
      wall.innerHTML = Array(50)
        .fill(
          '<p style="margin:0;flex:1;background:#eee">What happens next: continue reading the project update.</p>',
        )
        .join("");
      document.body.append(wall);
    });
    await page.evaluate("window.fixture.reposition()");
    assert.equal(await page.evaluate("window.fixture.shape()"), "tab");
    assert.equal(await root.locator(".fab").isVisible(), true);
    assert.equal(await root.locator(".fab-badge").isVisible(), true);
    if (process.env.OWNER_PLACEMENT_SCREENSHOTS) {
      mkdirSync(process.env.OWNER_PLACEMENT_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: `${process.env.OWNER_PLACEMENT_SCREENSHOTS}/owner-crowded-390.png`,
      });
    }
    await root.locator(".fab").click();
    assert.equal(await page.evaluate("window.opened"), true);
    await page.evaluate("document.getElementById('wall').remove(); window.fixture.reposition()");
    assert.equal(await page.evaluate("window.fixture.shape()"), "button");

    // A remark would cover this host card, even though the launcher fits below.
    await page.evaluate(() => {
      const fab = document.getElementById("loki-feedback-host")!.shadowRoot!.querySelector(".fab")!;
      const rect = fab.getBoundingClientRect();
      const card = document.createElement("p");
      card.id = "reading";
      card.style.cssText = `position:fixed;margin:0;right:0;bottom:${800 - rect.bottom + 52}px;width:360px;height:44px;background:#eee`;
      card.textContent = "The next action you are reading must remain visible.";
      document.body.append(card);
    });
    await page.evaluate("window.fixture.say('Reading it, 3 things could be better')");
    assert.equal(await root.locator(".fab-bubble").isVisible(), false);
    await page.evaluate(
      "document.getElementById('reading').remove(); window.fixture.say('A new remark')",
    );
    assert.equal(await root.locator(".fab-bubble").isVisible(), true);
    await page.evaluate("document.dispatchEvent(new Event('scroll'))");
    assert.equal(await root.locator(".fab-bubble").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log("✓ owner footprint, edge fallback, unread access and safe remark previews");
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
