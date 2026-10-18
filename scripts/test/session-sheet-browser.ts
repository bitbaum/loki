/**
 * The session box and its sheet, as a phone shows them: one row of tools the
 * same size in both views, the agent named the same way everywhere, and a
 * choice of model or effort that visibly happens.
 *
 * On 2026-10-18 the owner pressed "Change" and "Set" on the sheet and
 * nothing moved: they typed `/model` and `/effort` into the terminal and
 * closed, and Claude Code drew its picker behind the conversation. The same
 * screenshots showed a 26px library button beside 44px round ones, a 36px
 * chip, a 34px Keys pill, "claude" on the tab and "Claude" in the box.
 *
 * Run: npx tsx scripts/test/session-sheet-browser.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import tailwind from "@tailwindcss/postcss";

async function main() {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const from = path.resolve("src/app/globals.css");
  const styles = await postcss([tailwind()]).process(fs.readFileSync(from, "utf8"), { from });
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ClaudeChatView}from'./src/components/terminal/ClaudeChatView';import{TerminalMobileHeader}from'./src/components/terminal/TerminalMobileHeader';import{MobileNav}from'./src/components/shell/MobileNav';import{SessionComposer}from'./src/components/terminal/SessionComposer';import{KeysToggle,TerminalMobileDock}from'./src/components/terminal/TerminalMobileDock';import{badgeNames}from'./src/components/terminal/terminal-strip-tabs';
      const roster=[{id:'claude',label:'Claude'},{id:'codex',label:'Codex'}];
      const root=createRoot(document.getElementById('app'));
      window.mount=(fixture)=>{window.fixture=fixture;const agent=badgeNames(fixture.badge,roster);root.render(<div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary"><div className="app-main-column"><div className="ui-app-topbar" style={{height:48}}>Loki</div><main className="app-main"><div className="app-page app-viewport-pane flex flex-col" data-fc-place="tab"><TerminalMobileHeader title="Center SOM" state="live" agent={agent} onOpenSheet={()=>{}} immersive={false} onToggleImmersive={()=>{}} view={fixture.terminal?"terminal":"chat"} onViewChange={()=>{}}/>{fixture.terminal?<div className="flex flex-1 flex-col"><div className="flex-1 bg-black p-2 text-xs text-white">terminal</div><TerminalMobileDock onKey={()=>{}} keysOpen={false} onKeysOpenChange={()=>{}} immersive={false} box={<SessionComposer tab="center-som" channel="cloud" onKey={async()=>{}} live agent="claude" agentLabel={agent} suggestions={[]} project="center-som" density="comfortable" tools={<span className="md:hidden"><KeysToggle open={false} onOpenChange={()=>{}}/></span>}/>}/></div>:<ClaudeChatView key={fixture.key} tab="center-som" channel="cloud" onLive={()=>{}} onKey={async bytes=>{window.written.push(bytes)}} onShowTerminal={()=>{}} onExplain={()=>{}}/>}</div></main></div><MobileNav/></div>)};window.written=[];`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(?:next\/navigation|@\/hooks\/use-claude-transcript|@\/hooks\/use-watch-narration)$/,
            },
            (a) => ({ path: a.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            loader: "js",
            contents: a.path.includes("use-claude-transcript")
              ? "export const useClaudeTranscript=()=>window.fixture"
              : a.path.includes("use-watch-narration")
                ? "export const useWatchNarration=()=>[]"
                : "export const usePathname=()=>'/terminal';export const useRouter=()=>({push(){},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();",
          }));
        },
      },
    ],
  });
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ session sheet skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) =>
      r.fulfill(
        r.request().url().includes("/api/")
          ? { contentType: "application/json", body: "{}" }
          : {
              contentType: "text/html",
              body: `<style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
            },
      ),
    );
    await page.goto("http://terminal.fixture/terminal");
    await page.evaluate(() =>
      Object.assign(window, { process: { env: { NODE_ENV: "production" } } }),
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const now = new Date().toISOString();
    const items = [
      { id: "u1", kind: "user", at: now, text: "Rename the site to Center SOM.", mode: "auto" },
      {
        id: "a1",
        kind: "assistant",
        at: now,
        text: "Done. The site is now called Center SOM on every page.",
        model: "claude-opus-4-5-20251101",
        effort: "medium",
      },
    ];
    const mount = (f: Record<string, unknown>) =>
      page.evaluate((x) => (window as unknown as { mount: (f: unknown) => void }).mount(x), f);
    const toolRow = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".ck-actions button")]
          .filter((e) => !e.closest("dialog"))
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              h: Math.round(r.height),
              y: Math.round(r.top),
              x: Math.round(r.left),
              mic: e.classList.contains("ck-mic"),
              send: e.classList.contains("ck-send"),
              label: e.getAttribute("aria-label") ?? e.textContent?.trim(),
            };
          }),
      );

    for (const terminal of [false, true]) {
      await mount({
        key: terminal ? "term" : "chat",
        items,
        connected: true,
        received: true,
        sessionId: "s",
        terminal,
        badge: "claude",
      });
      await page.getByRole("button", { name: /^Send/ }).waitFor();
      const row = await toolRow();
      const view = terminal ? "terminal view" : "conversation view";
      fs.mkdirSync(".tmp/session-sheet", { recursive: true });
      await page.screenshot({
        path: `.tmp/session-sheet/${terminal ? "terminal" : "chat"}-390.png`,
      });
      assert.ok(row.length >= 4, `${view}: a row of tools`);
      for (const b of row)
        assert.equal(b.h, 44, `${view}: every tool is one size — ${b.label} is ${b.h}px`);
      assert.equal(new Set(row.map((b) => b.y)).size, 1, `${view}: one row, nothing wrapped`);
      // The microphone is beside Send in both views, not second from the
      // left in one and beside Send in the other.
      const mic = row.find((b) => b.mic)!;
      const send = row.find((b) => b.send)!;
      for (const b of row)
        if (!b.mic && !b.send)
          assert.ok(b.x < mic.x, `${view}: ${b.label} sits left of the microphone`);
      assert.ok(mic.x < send.x, `${view}: the microphone sits beside Send`);
      // The agent is named, not its id, in the view switch and the box.
      assert.equal(
        await page.getByText(/\bclaude\b/).count(),
        0,
        `${view}: no lowercase agent id on screen`,
      );
      assert.ok(
        (await page.getByText(/\bClaude\b/).count()) >= 1,
        `${view}: the agent's name is on screen`,
      );
    }

    await mount({
      key: "chat2",
      items,
      connected: true,
      received: true,
      sessionId: "s",
      badge: "claude",
    });
    const chip = page.locator('button[aria-label^="Model and mode"]');
    assert.match(
      (await chip.getAttribute("aria-label")) ?? "",
      /Opus 4\.5 · Auto/,
      "the chip names the model and the mode",
    );
    await chip.click();
    const sheet = page.getByRole("dialog");
    await sheet.getByText(/^Opus 4\.5/).waitFor();
    await page.screenshot({ path: ".tmp/session-sheet/sheet-390.png" });
    assert.ok(await sheet.getByText("Medium effort").isVisible(), "the effort in force is shown");

    // Every family Claude Code knows by alias, most capable first.
    assert.deepEqual(
      await sheet
        .getByRole("group", { name: "Change the model" })
        .getByRole("button")
        .allTextContents(),
      ["Fable", "Opus", "Sonnet", "Haiku"],
      "the model choices, Fable first",
    );

    // A choice is made on the sheet, sends the agent's own command, and the
    // sheet stays open saying what is changing.
    await sheet.getByRole("button", { name: "Sonnet" }).click();
    await sheet.getByRole("button", { name: "High", exact: true }).click();
    const written = await page.evaluate(() => (window as unknown as { written: string[] }).written);
    assert.deepEqual(
      written,
      ["/model sonnet\r", "/effort high\r"],
      "each choice is the command with the choice named",
    );
    assert.ok(
      await sheet.getByText("Switching to Sonnet").isVisible(),
      "the sheet says the model is changing",
    );
    await page.screenshot({ path: ".tmp/session-sheet/sheet-changing-390.png" });
    // The chip asked for is the one marked, not the one still in force.
    for (const [name, pressed] of [
      ["Sonnet", "true"],
      ["Opus", "false"],
      ["High", "true"],
      ["Medium", "false"],
    ] as const) {
      assert.equal(
        await sheet.getByRole("button", { name, exact: true }).getAttribute("aria-pressed"),
        pressed,
        `${name} is ${pressed === "true" ? "" : "not "}marked while the change is under way`,
      );
    }
    assert.ok(
      await sheet.getByText("Switching to High effort").isVisible(),
      "the sheet says the effort is changing",
    );
    assert.match(
      (await chip.getAttribute("aria-label")) ?? "",
      /Sonnet…/,
      "the chip shows the change under way",
    );
    // A choice already in force sends nothing.
    await sheet.getByRole("button", { name: "Sonnet" }).click();
    assert.equal(
      (await page.evaluate(() => (window as unknown as { written: string[] }).written)).length,
      2,
    );

    // Claude Code answers in the log the moment it switches: the sheet,
    // still open, settles on its word — not on the next answer.
    const replies = [
      {
        id: "s1",
        kind: "setting",
        at: now,
        setting: "model",
        value: "Sonnet 5.5",
        text: "Model set to Sonnet 5.5",
      },
      {
        id: "s2",
        kind: "setting",
        at: now,
        setting: "effort",
        value: "high",
        text: "Effort set to high",
      },
    ];
    await mount({
      key: "chat2",
      items: [...items, ...replies],
      connected: true,
      received: true,
      sessionId: "s",
      badge: "claude",
    });
    await sheet.getByText("In force for this session. Pick another to switch.").waitFor();
    assert.match(
      (await chip.getAttribute("aria-label")) ?? "",
      /Sonnet 5\.5 · Auto/,
      "the chip names the model Claude Code switched to",
    );
    assert.equal(await sheet.getByText("Switching to").count(), 0, "nothing reads as pending");
    assert.ok(
      await page.getByText("Model set to Sonnet 5.5").isVisible(),
      "the conversation says it too, where it happened",
    );
    await page.screenshot({ path: ".tmp/session-sheet/sheet-settled-390.png" });

    // A family the account cannot use: Claude Code's refusal, in its words,
    // and the model in force stays marked.
    await sheet.getByRole("button", { name: "Fable" }).click();
    assert.equal(
      (await page.evaluate(() => (window as unknown as { written: string[] }).written)).at(-1),
      "/model fable\r",
    );
    await mount({
      key: "chat2",
      items: [
        ...items,
        ...replies,
        {
          id: "s3",
          kind: "setting",
          at: now,
          setting: "model",
          value: null,
          text: "Model 'fable' isn't available for your account",
        },
      ],
      connected: true,
      received: true,
      sessionId: "s",
      badge: "claude",
    });
    await sheet
      .getByText("Claude Code said: Model 'fable' isn't available for your account")
      .waitFor();
    assert.equal(
      await sheet.getByRole("button", { name: "Sonnet", exact: true }).getAttribute("aria-pressed"),
      "true",
      "after a refusal the model in force is the one marked",
    );
    await page.screenshot({ path: ".tmp/session-sheet/sheet-refused-390.png" });
    await page.keyboard.press("Escape");

    // An older runner sends no reply: the next answer naming the model
    // settles it instead.
    await mount({
      key: "chat3",
      items: [
        ...items,
        {
          id: "a2",
          kind: "assistant",
          at: now,
          text: "Switched.",
          model: "claude-sonnet-4-5-20250929",
          effort: "high",
        },
      ],
      connected: true,
      received: true,
      sessionId: "s",
      badge: "claude",
    });
    // root.render commits on its own tick: wait for the label, do not read it.
    await page.waitForFunction(
      () =>
        /Sonnet 4\.5 · Auto/.test(
          document
            .querySelector('button[aria-label^="Model and mode"]')
            ?.getAttribute("aria-label") ?? "",
        ),
      null,
      { timeout: 10_000 },
    );
    const settled = (await chip.getAttribute("aria-label")) ?? "";
    assert.match(
      settled,
      /Sonnet 4\.5 · Auto/,
      `the chip settles on what the log says (got "${settled}")`,
    );
    assert.deepEqual(errors, []);
    console.log(
      "✓ session-sheet: one row of 44px tools in both views, the agent named, a choice that settles on Claude Code's own word",
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  console.error(`✗ session-sheet: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
