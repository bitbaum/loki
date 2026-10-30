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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ClaudeChatView}from'./src/components/terminal/ClaudeChatView';import{TerminalMobileHeader}from'./src/components/terminal/TerminalMobileHeader';import{MobileNav}from'./src/components/shell/MobileNav';import{SessionComposer}from'./src/components/terminal/SessionComposer';import{TerminalMobileDock}from'./src/components/terminal/TerminalMobileDock';import{badgeNames}from'./src/components/terminal/terminal-strip-tabs';import{TerminalLokiRail}from'./src/components/terminal/TerminalLokiRail';import{TerminalLokiSheet}from'./src/components/terminal/TerminalExplain';
      const roster=[{id:'claude',label:'Claude'},{id:'codex',label:'Codex'}];
      function Dock({agent}){const[open,setOpen]=React.useState(false);return <TerminalMobileDock onKey={()=>{}} keysOpen={open} onKeysOpenChange={setOpen} immersive={false} session={{tab:'center-som',channel:'cloud',agent:'claude',onKey:async bytes=>{window.written.push(bytes)}}} box={tools=><SessionComposer tab="center-som" channel="cloud" onKey={async bytes=>{window.written.push(bytes)}} live agent="claude" agentLabel={agent} suggestions={open?[]:["run the project's unit tests","open the main source file for review"]} onExplain={open?undefined:()=>{}} project="center-som" density="comfortable" tools={tools} onOpenKeys={()=>setOpen(true)}/>}/>}
      const root=createRoot(document.getElementById('app'));
      window.mount=(fixture)=>{window.fixture=fixture;const agent=badgeNames(fixture.badge,roster);root.render(<div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary"><div className="app-main-column"><div className="ui-app-topbar" style={{height:48}}>Loki</div><main className="app-main"><div className="app-page app-viewport-pane flex flex-col" data-fc-place="tab"><TerminalMobileHeader title="Center SOM" state="live" agent={agent} builder="Cloud runner" sessionCount={2} backHref="/control" onOpenSheet={()=>{}} onOpenMore={()=>{}} view={fixture.terminal?"terminal":"chat"} onViewChange={()=>{}}/>{fixture.terminal?<div className="flex flex-1 flex-col"><div className="flex-1 bg-black p-2 text-xs text-white">terminal</div><Dock agent={agent}/></div>:<ClaudeChatView key={fixture.key} tab="center-som" channel="cloud" onLive={()=>{}} onKey={async bytes=>{window.written.push(bytes)}} onShowTerminal={()=>{}} onExplain={()=>{}}/>}</div></main></div><MobileNav/>{fixture.loki&&<TerminalLokiSheet onClose={()=>{}}><TerminalLokiRail presentation="sheet" project="Center SOM" tab="center-som" runId={null} ptyState="live" projectId={null} canSwitchAgent={false} onSwitchAgent={()=>{}} askOnly agent="claude" onKey={()=>{}}/></TerminalLokiSheet>}</div>)};window.written=[];`,
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
    // A phone: touch and a coarse pointer, so nothing grabs a real keyboard.
    const page = await browser.newPage({
      viewport: { width: 390, height: 780 },
      isMobile: true,
      hasTouch: true,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // The session's screen, for the sheet's live mode: Claude Code's footer,
    // moved one mode along for every Shift+Tab the page has written.
    const FOOTERS = [
      "⏵⏵ auto mode on (shift+tab to cycle)",
      "⏸ manual mode on · ? for shortcuts",
      "⏵⏵ accept edits on (shift+tab to cycle)",
      "⏸ plan mode on (shift+tab to cycle)",
    ];
    await page.route("**/api/control/peek-stream**", async (r) => {
      const presses = await page
        .evaluate(() => (window as unknown as { written?: string[] }).written ?? [])
        .then((w) => w.filter((b) => b === "\x1b[Z").length)
        .catch(() => 0);
      const frame = `> \n────\n  ${FOOTERS[presses % FOOTERS.length]}\n`;
      await r.fulfill({
        contentType: "text/event-stream",
        body: `retry: 100\n\nevent: ready\ndata: {}\n\nevent: frame\ndata: ${JSON.stringify({ frame, append: false })}\n\n`,
      });
    });
    await page.route(/^(?!.*peek-stream).*$/, (r) =>
      r.fulfill(
        r.request().url().includes("/api/terminal/next-steps")
          ? {
              contentType: "application/json",
              body: JSON.stringify({ steps: ["Rename the folder too.", "Show me the site."] }),
            }
          : r.request().url().includes("/api/")
            ? { contentType: "application/json", body: "{}" }
            : {
                contentType: "text/html",
                body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
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
          // chatkit's own paperclip is mounted but hidden: "+" opens it.
          .filter((e) => !e.closest("dialog") && e.getClientRects().length > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              h: Math.round(r.height),
              y: Math.round(r.top),
              x: Math.round(r.left),
              mic: e.classList.contains("ck-mic"),
              send: e.classList.contains("ck-send"),
              label: e.getAttribute("aria-label") ?? e.textContent?.trim(),
              right: Math.round(r.right),
              edge: Math.round(e.closest(".ck-composer")!.getBoundingClientRect().right),
            };
          }),
      );

    const rows: string[][] = [];
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
      assert.equal(
        await page
          .getByRole("group", { name: "Show this session as" })
          .getByRole("button", { pressed: true })
          .textContent(),
        terminal ? "Terminal" : "Chat",
        `${view}: the pill marks the view on screen`,
      );
      if (!terminal) {
        // A short conversation starts under the header, as the chat apps do:
        // bottom-anchored to the box it opened on ~200px of nothing above the
        // first message (owner, 2026-10-19).
        const gap = await page.evaluate(
          () =>
            document.querySelector(".ui-loki-turn-user")!.getBoundingClientRect().top -
            document.querySelector(".ui-loki-thread")!.getBoundingClientRect().top,
        );
        assert.ok(gap <= 32, `the first message starts at the top of the thread (${gap}px down)`);
      }
      fs.mkdirSync(".tmp/session-sheet", { recursive: true });
      await page.screenshot({
        path: `.tmp/session-sheet/${terminal ? "terminal" : "chat"}-390.png`,
      });
      // + · the model · the microphone · Send — the four a chat app has.
      assert.deepEqual(
        [...row]
          .sort((a, b) => a.x - b.x)
          .map((b) =>
            b.mic ? "mic" : b.send ? "send" : (b.label ?? "").replace(/^Model: .*/, "Model"),
          ),
        ["Add a photo, a command or a prompt", "Model", "mic", "send"],
        `${view}: +, the model, the microphone and Send — nothing else`,
      );
      // The header: back · the session's name · ⋮ on one line, the pill under.
      const [back, name, more, pill] = await page.evaluate(
        (sels) =>
          sels.map((sel) => {
            const r = document.querySelector(sel)!.getBoundingClientRect();
            return { top: Math.round(r.top), mid: Math.round(r.left + r.width / 2) };
          }),
        [
          'a[aria-label="Back to Home"]',
          ".ui-term-mhead-btn",
          'button[aria-label^="More"]',
          ".ui-term-mhead .ui-term-views",
        ],
      );
      const head = {
        back: back!,
        name: name!,
        more: more!,
        pill: pill!,
        sub: await page.locator(".ui-term-mhead-sub").textContent(),
      };
      assert.equal(
        new Set([head.back.top, head.more.top]).size,
        1,
        `${view}: back and ⋮ on one line`,
      );
      assert.ok(Math.abs(head.name.mid - 195) <= 2, `${view}: the name is centred`);
      assert.ok(Math.abs(head.pill.mid - 195) <= 2, `${view}: the pill is centred`);
      assert.ok(head.pill.top > head.name.top, `${view}: the pill sits under the name`);
      assert.equal(head.sub, "Claude · 2 sessions · cloud runner", `${view}: what runs it, where`);
      rows.push(row.map((b) => b.label ?? ""));
      for (const b of row)
        assert.equal(b.h, 44, `${view}: every tool is one size — ${b.label} is ${b.h}px`);
      assert.equal(new Set(row.map((b) => b.y)).size, 1, `${view}: one row, nothing wrapped`);
      for (const b of row)
        assert.ok(
          b.right <= b.edge,
          `${view}: ${b.label} is inside the box (${b.right} > ${b.edge})`,
        );
      // The microphone is beside Send in both views, not second from the
      // left in one and beside Send in the other.
      const mic = row.find((b) => b.mic)!;
      const send = row.find((b) => b.send)!;
      for (const b of row)
        if (!b.mic && !b.send)
          assert.ok(b.x < mic.x, `${view}: ${b.label} sits left of the microphone`);
      assert.ok(mic.x < send.x, `${view}: the microphone sits beside Send`);
      if (terminal) {
        // The keys open from the terminal's corner and close from the deck
        // itself: nothing here is one-way (the owner refreshed the page to
        // be rid of it).
        await page.getByRole("button", { name: "Keys", exact: true }).click();
        await page.getByRole("button", { name: "Hide the keys" }).waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Keys", exact: true })
            .getAttribute("aria-pressed"),
          "true",
          "the corner button reads as on",
        );
        assert.equal(
          await page.locator(".ui-term-suggests").count(),
          0,
          "the next-step row steps aside while the keys are up",
        );
        await page.screenshot({ path: ".tmp/session-sheet/keys-390.png" });
        await page.getByRole("button", { name: "Hide the keys" }).click();
        await page.getByRole("button", { name: "Hide the keys" }).waitFor({ state: "detached" });
        assert.equal(
          await page
            .getByRole("button", { name: "Keys", exact: true })
            .getAttribute("aria-pressed"),
          "false",
          "and off again",
        );
        // Keys sits on the terminal's corner, not in the box's row.
        const keys = await page.getByRole("button", { name: "Keys", exact: true }).evaluate((e) => {
          const r = e.getBoundingClientRect();
          const box = document.querySelector(".ck-composer")!.getBoundingClientRect();
          return { h: Math.round(r.height), bottom: r.bottom, right: r.right, boxTop: box.top };
        });
        assert.equal(keys.h, 44, "Keys is the same size as the tools");
        assert.ok(keys.bottom <= keys.boxTop, "Keys floats above the box, on the terminal");
        assert.ok(keys.right <= 390, "Keys is on screen");
      }
      // The model chip is in BOTH views (owner, 2026-10-19: it was only in
      // the conversation, and the terminal view had no way to switch).
      assert.match(
        (await page.locator('button[aria-label^="Model: "]').getAttribute("aria-label")) ?? "",
        /^Model: Opus 4\.5, Auto mode/,
        `${view}: the model chip names the model`,
      );
      // While typing on a phone: no app bar, no view switch, the next steps
      // in one sideways row — the terminal keeps the room.
      // Set and read in one go: MobileNav owns this class and puts it back to
      // what the (absent) keyboard says on its next effect.
      const typing = await page.evaluate(() => {
        document.body.classList.add("fc-keyboard-open");
        return {
          bar: getComputedStyle(document.querySelector(".ui-app-topbar")!).display,
          views: document.querySelector(".ui-term-views")
            ? getComputedStyle(document.querySelector(".ui-term-views")!).display
            : "none",
          rows: new Set(
            [...document.querySelectorAll(".ui-term-suggests > li")].map((li) =>
              Math.round(li.getBoundingClientRect().top),
            ),
          ).size,
          wide: document.documentElement.scrollWidth,
        };
      });
      await page.evaluate(() => document.body.classList.remove("fc-keyboard-open"));
      if (terminal) assert.equal(typing.bar, "none", `${view}: the app bar steps aside`);
      assert.equal(typing.views, "none", `${view}: the view switch steps aside`);
      assert.ok(typing.rows <= 1, `${view}: next steps in one row while typing`);
      assert.equal(typing.wide, 390, `${view}: nothing scrolls the page sideways`);
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

    assert.deepEqual(
      rows[1]!.map((l) => l.replace(/^Model: .*/, "Model")),
      rows[0]!.map((l) => l.replace(/^Model: .*/, "Model")),
      "the box's row is the same in both views",
    );

    // The conversation view's next steps are replies under the answer, not
    // chips over the box — and "What's going on?" is the header's ⋮ there.
    await mount({ key: "replies", items, connected: true, received: true, sessionId: "s" });
    const replyList = page.getByRole("list", { name: /^Replies/ });
    await replyList.getByRole("button", { name: "Show me the site." }).waitFor();
    const placedReplies = await page.evaluate(() => ({
      under:
        document.querySelector(".ui-reply-steps")!.getBoundingClientRect().top >
        [...document.querySelectorAll(".ui-loki-thread p, .ui-loki-thread div")]
          .find((e) => e.textContent?.startsWith("Done. The site"))!
          .getBoundingClientRect().top,
      above:
        document.querySelector(".ui-reply-steps")!.getBoundingClientRect().bottom <=
        document.querySelector(".ck-composer")!.getBoundingClientRect().top,
      chips: [...document.querySelectorAll(".ui-claude-chat .ui-term-suggests")].filter(
        (e) => e.getClientRects().length > 0,
      ).length,
    }));
    assert.ok(placedReplies.under, "the replies sit under the answer");
    assert.ok(placedReplies.above, "and above the box");
    assert.equal(placedReplies.chips, 0, "no chip row over the box on a phone");
    await page.screenshot({ path: ".tmp/session-sheet/replies-390.png" });
    await replyList.getByRole("button", { name: "Show me the site." }).click();
    await page.waitForFunction(() =>
      (window as unknown as { written: string[] }).written.some((w) =>
        w.includes("Show me the site."),
      ),
    );
    // The Enter follows the words as its own keystroke.
    await page.waitForFunction(
      () => (window as unknown as { written: string[] }).written.at(-1) === "\r",
    );
    await page.evaluate(() => Object.assign(window, { written: [] }));

    // A plan limit (owner, 2026-10-19): the chip names the model that hit it,
    // and the replies are Claude Code's own commands, typed as commands.
    await mount({
      key: "limit",
      items: [
        items[0],
        {
          id: "lim",
          kind: "assistant",
          at: now,
          text: "You've reached your Fable limit. Run /usage-credits to continue or switch models with /model.",
        },
      ],
      connected: true,
      received: true,
      sessionId: "s",
    });
    const limitRows = page.getByRole("list", { name: /^Replies/ });
    await limitRows.getByRole("button", { name: "Use Opus" }).waitFor();
    assert.deepEqual(
      await limitRows.getByRole("button").allTextContents(),
      ["Use Opus", "Use Sonnet", "Continue with usage credits"],
      "the way past a limit, in words",
    );
    assert.match(
      (await page.locator('button[aria-label^="Model: "]').getAttribute("aria-label")) ?? "",
      /^Model: Fable/,
      "the chip names the model that hit the limit",
    );
    await limitRows.getByRole("button", { name: "Use Opus" }).click();
    await page.waitForFunction(
      () => (window as unknown as { written: string[] }).written.length === 2,
    );
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { written: string[] }).written),
      ["/model opus", "\r"],
      "typed as the command, Enter on its own",
    );
    await page.screenshot({ path: ".tmp/session-sheet/limit-390.png" });
    await page.evaluate(() => Object.assign(window, { written: [] }));

    // "+": a sheet from the bottom with everything that is not words — a
    // photo, the keys, the commands — nothing taking the keyboard, nothing
    // off the top of the screen (owner, 2026-10-19: the panel pinned above the
    // box ran over the header with the commands clipped, and its search
    // raised the keyboard).
    const plus = page.getByRole("button", { name: "Add a photo, a command or a prompt" });
    const commands = page.getByRole("dialog", { name: "Add to the session" });
    // The conversation view has no keys to open.
    await plus.click();
    await commands.getByRole("button", { name: "Photo or screenshot" }).waitFor();
    assert.equal(await commands.getByRole("button", { name: /^Keys/ }).count(), 0);
    await page.keyboard.press("Escape");
    await mount({
      key: "term2",
      items,
      connected: true,
      received: true,
      sessionId: "s",
      terminal: true,
      badge: "claude",
    });
    await plus.click();
    // In the terminal view the keys a phone lacks are here too.
    await commands.getByRole("button", { name: /^Keys/ }).click();
    await page.getByRole("button", { name: "Hide the keys" }).waitFor();
    await page.getByRole("button", { name: "Hide the keys" }).click();
    // "Photo or screenshot" opens chatkit's own Camera / Photos / Files sheet.
    await plus.click();
    await commands.getByRole("button", { name: "Photo or screenshot" }).click();
    await page.waitForFunction(() =>
      Boolean(document.querySelector<HTMLDialogElement>(".ui-session-box dialog.ck-sheet")?.open),
    );
    assert.ok(
      await page.getByRole("button", { name: "Camera" }).isVisible(),
      "the photo row opens Camera / Photos / Files",
    );
    await page.screenshot({ path: ".tmp/session-sheet/photo-390.png" });
    await page.evaluate(() =>
      document.querySelector<HTMLDialogElement>(".ui-session-box dialog.ck-sheet")!.close(),
    );
    await plus.click();
    await commands.getByText("Use Opus").waitFor();
    const placed = await commands.evaluate((d) => {
      const r = d.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight };
    });
    assert.ok(placed.top >= 0, `the sheet starts on screen (top ${placed.top})`);
    assert.ok(placed.bottom <= placed.h, "and ends on screen");
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.tagName),
      "INPUT",
      "nothing in it raises the phone keyboard",
    );
    await page.screenshot({ path: ".tmp/session-sheet/commands-390.png" });
    await commands.getByText("Use Opus").click();
    await page.waitForFunction(
      () => (window as unknown as { written: string[] }).written.length === 2,
    );
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { written: string[] }).written),
      ["/model opus", "\r"],
      "a command in the sheet is typed into the session, Enter on its own",
    );
    await page.evaluate(() => Object.assign(window, { written: [] }));
    await page.keyboard.press("Escape");

    await mount({
      key: "chat2",
      items,
      connected: true,
      received: true,
      sessionId: "s",
      badge: "claude",
    });
    const chip = page.locator('button[aria-label^="Model: "]');
    assert.match(
      (await chip.getAttribute("aria-label")) ?? "",
      /Model: Opus 4\.5, Auto mode/,
      "the chip names the model and the mode",
    );
    await chip.click();
    const sheet = page.getByRole("dialog");
    await sheet.getByText("Answering now: Opus 4.5.").waitFor();
    await page.screenshot({ path: ".tmp/session-sheet/sheet-390.png" });
    assert.equal(
      await sheet.getByRole("radio", { name: "Medium", exact: true }).getAttribute("aria-checked"),
      "true",
      "the effort in force is the one marked",
    );

    // Every family Claude Code knows by alias, most capable first.
    assert.deepEqual(
      await sheet.getByRole("radiogroup", { name: "Model" }).getByRole("radio").allTextContents(),
      ["Fable", "Opus", "Sonnet", "Haiku"],
      "the model choices, Fable first",
    );
    // Each row is ONE line of equal cells — "Max" alone on a second line,
    // each pill as wide as its word, was the owner's "Frankenstein" (2026-10-19).
    for (const group of ["Model", "Effort"]) {
      const cells = await sheet
        .getByRole("radiogroup", { name: group })
        .getByRole("radio")
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { top: Math.round(r.top), width: Math.round(r.width) };
          }),
        );
      assert.equal(new Set(cells.map((c) => c.top)).size, 1, `${group}: every choice on one line`);
      assert.ok(
        Math.max(...cells.map((c) => c.width)) - Math.min(...cells.map((c) => c.width)) <= 1,
        `${group}: every choice the same width (${cells.map((c) => c.width).join(", ")})`,
      );
    }
    // And the chosen one says what it does — the reason to pick it.
    assert.ok(
      await sheet.getByText("Thinks briefly first. For everyday changes.").isVisible(),
      "the effort in force says what it means",
    );

    // A choice is made on the sheet, sends the agent's own command, and the
    // sheet stays open saying what is changing.
    await sheet.getByRole("radio", { name: "Sonnet" }).click();
    await sheet.getByRole("radio", { name: "High", exact: true }).click();
    // The command and its Enter are separate writes with a beat between,
    // and the second command waits for the first's Enter — two quick taps
    // never interleave (lib/session-keystrokes typeCommand).
    await page.waitForFunction(
      () => (window as unknown as { written: string[] }).written.length === 4,
    );
    const written = await page.evaluate(() => (window as unknown as { written: string[] }).written);
    assert.deepEqual(
      written,
      ["/model sonnet", "\r", "/effort high", "\r"],
      "each choice is the command with the choice named, then Enter on its own",
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
        await sheet.getByRole("radio", { name, exact: true }).getAttribute("aria-checked"),
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
      /Model: Sonnet…/,
      "the chip shows the change under way",
    );
    // A choice already in force sends nothing.
    await sheet.getByRole("radio", { name: "Sonnet" }).click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => (window as unknown as { written: string[] }).written);
    assert.equal(after.length, 4, `a choice in force sends nothing (got ${JSON.stringify(after)})`);

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
    await sheet.getByText("Answering now: Sonnet 5.5.").waitFor();
    assert.match(
      (await chip.getAttribute("aria-label")) ?? "",
      /Model: Sonnet 5\.5, Auto mode/,
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
    await sheet.getByRole("radio", { name: "Fable" }).click();
    await page.waitForFunction(
      () => (window as unknown as { written: string[] }).written.at(-1) === "\r",
    );
    assert.equal(
      (await page.evaluate(() => (window as unknown as { written: string[] }).written)).at(-2),
      "/model fable",
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
      await sheet.getByRole("radio", { name: "Sonnet", exact: true }).getAttribute("aria-checked"),
      "true",
      "after a refusal the model in force is the one marked",
    );
    await page.screenshot({ path: ".tmp/session-sheet/sheet-refused-390.png" });

    // The mode: listed with what each means, the one on the screen marked,
    // and a tap walks Shift+Tab until Claude Code's own footer names it — it
    // was a "Next mode" button whose result showed "with your next message",
    // so pressing it looked like nothing happened (owner, 2026-10-19).
    await page.evaluate(() => Object.assign(window, { written: [] }));
    const modes = sheet.getByRole("radiogroup", { name: "Mode" });
    assert.deepEqual(
      (await modes.getByRole("button").allTextContents()).map(
        (t) => t.split(/(?<=[a-z])(?=[A-Z])/)[0],
      ),
      ["Ask first", "Edits freely", "Plan only", "Auto"],
      "the modes, by what they let it do",
    );
    await modes.getByRole("button", { name: /^Auto/, pressed: true }).waitFor();
    await modes.getByRole("button", { name: /^Plan only/ }).click();
    await modes.getByRole("button", { name: /^Plan only/, pressed: true }).waitFor();
    // Wait out the walk: the row is marked while it is asked for, too.
    await sheet.locator(".ui-spinner-sm").waitFor({ state: "detached" });
    assert.equal(
      (await page.evaluate(() => (window as unknown as { written: string[] }).written)).filter(
        (b) => b === "\x1b[Z",
      ).length,
      3,
      "auto → manual → accept edits → plan: three presses, then it stops",
    );
    assert.match(
      (await chip.getAttribute("aria-label")) ?? "",
      /Plan only mode/,
      "the chip's label follows the screen, not the last message",
    );
    await page.screenshot({ path: ".tmp/session-sheet/sheet-mode-390.png" });
    await page.keyboard.press("Escape");

    // "What's going on?" on a phone: a sheet with the question, room for
    // the answer, and one way to Loki chat — no second box, no second model
    // picker, nothing about the run when nothing is tracked.
    await mount({
      key: "chat2",
      items,
      connected: true,
      received: true,
      sessionId: "s",
      badge: "claude",
      loki: true,
    });
    const loki = page.getByRole("dialog").filter({ hasText: "Loki on Center SOM" });
    await loki.waitFor();
    const lokiBox = await loki.evaluate((d) => {
      const r = d.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        composers: d.querySelectorAll(".ck-composer").length,
        pickers: d.querySelectorAll(".ui-loki-model-trigger").length,
        text: d.textContent ?? "",
      };
    });
    assert.ok(lokiBox.top >= 0 && lokiBox.bottom <= 780, "the sheet is on screen");
    assert.equal(lokiBox.composers, 0, "no second box in it");
    assert.equal(lokiBox.pickers, 0, "no second model picker in it");
    assert.ok(!lokiBox.text.includes("Nothing running"), "no run-status filler");
    assert.ok(
      await loki.getByRole("button", { name: "What's going on?" }).isVisible(),
      "the question is there to ask",
    );
    assert.ok(
      await loki.getByRole("link", { name: /Continue in Loki chat/ }).isVisible(),
      "and one way to Loki chat",
    );
    await page.screenshot({ path: ".tmp/session-sheet/loki-sheet-390.png" });
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
        /Model: Sonnet 4\.5, Auto mode/.test(
          document.querySelector('button[aria-label^="Model: "]')?.getAttribute("aria-label") ?? "",
        ),
      null,
      { timeout: 10_000 },
    );
    const settled = (await chip.getAttribute("aria-label")) ?? "";
    assert.match(
      settled,
      /Model: Sonnet 4\.5, Auto mode/,
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
