// Loki for Firefox, end to end in a real browser: the BUILT extension
// (scripts/build-extension.ts → extension/dist) loaded into Chromium, a Loki
// page asking it to fill, and the npm-shaped form filled in the tab it opens.
//
// Chromium stands in for Firefox here because it is the browser CI has; the
// extension uses only APIs both implement (see extension/src/api.ts).
//
// What it pins:
//   - the extension announces itself on Loki's origin, so /fill offers "Fill it here";
//   - a request from Loki's page opens the form in a new tab and fills it,
//     and the hand-off button is NOT pressed;
//   - the same npm page opened directly — no task for that tab — is untouched;
//   - a request with parameters that fail the recipe is refused.
//
// Needs Chromium; skips with a reason off CI, fails under CI.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";
import { BROWSER_EXTENSION } from "../../src/config/browser-tasks";
import { appBundle } from "./lib/npm-form-fixture";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const PARAMS = { package: "@bitbaum/chatkit", owner: "bitbaum", repo: "chatkit", workflow: "publish.yml" };
type State = { owner: string; repo: string; workflow: string; allow: boolean; tabPresses: number };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __state: State }).__state);
const submitted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted === true);

async function serve(context: BrowserContext, formJs: string) {
  await context.route("https://www.npmjs.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="root"></div><script>${formJs.replace(/<\/script/g, "<\\/script")}</script></body></html>`,
    }),
  );
  await context.route("https://loki.orangecat.ch/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><main>Loki</main></body></html>" }),
  );
}

async function ask(page: Page, params: Record<string, string>) {
  return page.evaluate(
    ({ request, reply, params }) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        window.addEventListener("message", (e) => {
          const d = e.data as { type?: string; reply?: { ok: boolean; error?: string } };
          if (d?.type === reply) resolve(d.reply ?? { ok: false });
        });
        window.postMessage({ type: request, recipe: "npm-trusted-publisher", params }, location.origin);
        setTimeout(() => resolve({ ok: false, error: "no reply" }), 5000);
      }),
    { request: BROWSER_EXTENSION.request, reply: BROWSER_EXTENSION.reply, params },
  );
}

async function main() {
  execFileSync("npx", ["tsx", "scripts/build-extension.ts"], { stdio: "ignore" });
  const ext = join(process.cwd(), "extension", "dist");
  const profile = mkdtempSync(join(tmpdir(), "loki-ext-"));
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: false,
      args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
  } catch (e) {
    rmSync(profile, { recursive: true, force: true });
    const why = (e as Error).message.split("\n")[0];
    if (process.env.CI) {
      console.error(`✗ Chromium is required under CI and could not launch: ${why}`);
      process.exit(1);
    }
    console.log(`↷ skipped: no Chromium on this machine (${why}). CI runs it.`);
    process.exit(0);
  }

  try {
    await serve(context, await appBundle());
    // The background must be up before the first message.
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");

    const loki = await context.newPage();
    await loki.goto("https://loki.orangecat.ch/fill?recipe=npm-trusted-publisher");
    const marker = await loki.evaluate((m) => document.documentElement.dataset[m], BROWSER_EXTENSION.marker);
    ok(marker === "1", "the extension announces itself on Loki's origin");

    const refused = await ask(loki, { ...PARAMS, owner: "not a name" });
    ok(!refused.ok, "parameters that fail the recipe are refused");

    const opened = context.waitForEvent("page");
    const reply = await ask(loki, PARAMS);
    ok(reply.ok, `Loki's request is accepted (${JSON.stringify(reply)})`);
    const form = await opened;
    await form.waitForLoadState();
    // Playwright attaches its request routing to an extension-opened tab a
    // beat after the first navigation starts, so that first load can miss the
    // fixture. Reloading also proves the real path a sign-in takes: the page
    // navigates, the script is injected again, and the tab's task survives.
    await form.reload();
    ok(form.url() === "https://www.npmjs.com/package/@bitbaum/chatkit/access", `opened the package's access page (${form.url()})`);
    await form.waitForFunction(
      () => (window as unknown as { __state?: State }).__state?.allow === true,
      undefined,
      { timeout: 10_000 },
    );
    const s = await state(form);
    ok(s.owner === "bitbaum" && s.repo === "chatkit" && s.workflow === "publish.yml", `fields filled (${JSON.stringify(s)})`);
    ok(await form.locator("#loki-handoff-banner").isVisible(), "the banner says what to press");
    ok(!(await submitted(form)), "the hand-off button is NOT pressed");

    // The same page without a task for its tab is left alone.
    const direct = await context.newPage();
    await direct.goto("https://www.npmjs.com/package/@bitbaum/chatkit/access");
    await direct.waitForSelector("button");
    await direct.waitForTimeout(2000);
    const d = await state(direct);
    ok(d.tabPresses === 0 && d.owner === "Bitbaum", "an npm page Loki did not open is untouched");
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
