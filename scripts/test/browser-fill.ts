// The browser hand-off filler (src/lib/browser-fill.ts), run the way Fleet
// Runner runs it — as source evaluated in a real page — against a React form
// built the way npm's trusted-publisher form is: a publisher button that
// reveals the fields, labels that are not <label for>, help text between a
// label and its input, an autofilled "Bitbaum", and a checkbox inside its label.
//
// What it pins:
//   - every field lands and SURVIVES React's next render (setting .value alone
//     is undone on re-render; this is the bug a naive filler ships with);
//   - the hand-off button is never pressed, on any run;
//   - a second run does not toggle the checkbox back off or re-press the tab;
//   - on another host (a sign-in page) nothing is touched.
//
// Needs Chromium; skips with a reason off CI, fails under CI.
import { existsSync, readFileSync } from "fs";
import { build } from "esbuild";
import { appBundle } from "./lib/npm-form-fixture";
import { chromium, type Browser, type Page } from "playwright";
import { resolveBrowserTask, type BrowserTask } from "../../src/config/browser-tasks";
import type { BrowserFillResult } from "../../src/lib/browser-fill";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

async function open(browser: Browser, origin: string, js: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="root"></div><script>${js.replace(/<\/script/g, "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto(`${origin}/package/@bitbaum/chatkit/access`);
  return page;
}

type ScriptFor = (task: BrowserTask) => string;
let scriptFor: ScriptFor;

async function fill(page: Page, task: BrowserTask): Promise<BrowserFillResult> {
  return page.evaluate(scriptFor(task)) as Promise<BrowserFillResult>;
}

/** browser-fill.ts bundled as electron-vite bundles the runner's main. */
async function bundledScriptFor(): Promise<ScriptFor> {
  const out = await build({
    entryPoints: ["src/lib/browser-fill.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const url = `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`;
  return ((await import(url)) as { browserFillScript: ScriptFor }).browserFillScript;
}

/** The filler as Fleet Runner's build actually ships it — the function the
 *  runner stringifies — when that build exists (after `pnpm run check:desktop`). */
function builtScriptFor(): ScriptFor | null {
  const out = "desktop/out/main/index.js";
  if (!existsSync(out)) return null;
  const bundle = readFileSync(out, "utf8");
  const m = bundle.match(/\nfunction fillBrowserForm\(task\) \{[\s\S]*?\n\}\n/);
  if (!m) throw new Error(`${out} has no top-level fillBrowserForm — the runner cannot send it`);
  const source = m[0].trim();
  return (task) => `(${source})(${JSON.stringify(task)})`;
}

type State = { owner: string; repo: string; workflow: string; allow: boolean; tabPresses: number };
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __state: State }).__state);
const submitted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted === true);

async function main() {
  // The recipe gate itself.
  const task = resolveBrowserTask("npm-trusted-publisher", {
    package: "@bitbaum/chatkit",
    owner: "bitbaum",
    repo: "chatkit",
    workflow: "publish.yml",
  });
  ok(
    !!task && task.url === "https://www.npmjs.com/package/@bitbaum/chatkit/access",
    "recipe builds the package's access page",
  );
  ok(
    resolveBrowserTask("npm-trusted-publisher", {
      package: "@bitbaum/chatkit",
      owner: "bitbaum",
      repo: "chatkit",
    }) === null,
    "a missing parameter is refused",
  );
  ok(
    resolveBrowserTask("npm-trusted-publisher", {
      package: "x",
      owner: "a b",
      repo: "c",
      workflow: "p.yml",
    }) === null,
    "a malformed owner is refused",
  );
  ok(
    resolveBrowserTask("npm-trusted-publisher", {
      package: "x",
      owner: "a",
      repo: "c",
      workflow: "../evil",
    }) === null,
    "a workflow that is not a .yml file is refused",
  );
  ok(
    resolveBrowserTask("open-anything", { url: "https://evil.example" }) === null,
    "an unknown recipe is refused",
  );
  if (!task) throw new Error("recipe did not build");

  let browser: Browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  } catch (e) {
    const why = (e as Error).message.split("\n")[0];
    if (process.env.CI) {
      console.error(`✗ Chromium is required under CI and could not launch: ${why}`);
      process.exit(1);
    }
    console.log(`↷ skipped browser half: no Chromium on this machine (${why}). CI runs it.`);
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }

  try {
    const js = await appBundle();
    // tsx (which runs this file) wraps functions in a __name helper the
    // shipped runner does not, so the in-process function is NOT what ships.
    // Test what does: the runner's own build when present, and always a bundle
    // built the way electron-vite builds main (no minify, no keepNames).
    const variants: Array<[string, ScriptFor]> = [
      ["runner-style bundle", await bundledScriptFor()],
    ];
    const built = builtScriptFor();
    if (built) variants.push(["Fleet Runner build", built]);
    else console.log("↷ Fleet Runner build not present; run check:desktop to test it too");
    for (const [variant, builder] of variants) {
      scriptFor = builder;
      const before = fail;
      await scenario(browser, js, task);
      ok(fail === before, `every check holds for the ${variant} build`);
    }
  } finally {
    await browser.close();
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function scenario(browser: Browser, js: string, task: BrowserTask) {
  {
    const page = await open(browser, "https://www.npmjs.com", js);
    await page.waitForSelector("button");

    // First pass reveals the form; the fields are not there yet.
    const first = await fill(page, task);
    ok(first.state === "waiting", "first pass waits while the publisher tab reveals the form");
    await page.waitForSelector("form");

    const second = await fill(page, task);
    ok(second.state === "ready", `second pass fills the form (got ${JSON.stringify(second)})`);
    // Let React re-render: a value set without React knowing is undone here.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    const s = await state(page);
    ok(s.owner === "bitbaum", `owner replaced, survives re-render (got "${s.owner}")`);
    ok(s.repo === "chatkit", `repository filled (got "${s.repo}")`);
    ok(s.workflow === "publish.yml", `workflow filled past its help text (got "${s.workflow}")`);
    ok(s.allow === true, "Allow npm publish ticked");
    const distTag = await page
      .locator("label", { hasText: "dist-tag" })
      .locator("input")
      .isChecked();
    ok(!distTag, "Allow npm dist-tag left alone");
    ok(!(await submitted(page)), "hand-off button NOT pressed");
    ok(
      await page.locator("#loki-handoff-banner").isVisible(),
      "banner tells the operator what to press",
    );

    // Idempotent: the runner keeps calling until ready; extra runs change nothing.
    const third = await fill(page, task);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    const s2 = await state(page);
    ok(third.state === "ready" && s2.allow === true, "a repeat run does not untick the checkbox");
    ok(
      s2.tabPresses === 1,
      `publisher tab pressed once, not re-toggled (pressed ${s2.tabPresses}x)`,
    );
    ok(!(await submitted(page)), "still not pressed after a repeat run");
    await page.close();

    // Another host — a sign-in page, say — is never touched.
    const elsewhere = await open(browser, "https://login.example.com", js);
    await elsewhere.waitForSelector("button");
    const r = await fill(elsewhere, task);
    ok(r.state === "elsewhere", "another host: reports where it is");
    ok((await state(elsewhere)).tabPresses === 0, "another host: nothing pressed");
    await elsewhere.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
