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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ClaudeChatView}from'./src/components/terminal/ClaudeChatView';import{ProjectWatchLive}from'./src/components/projects/ProjectWatchLive';import{TerminalMobileHeader}from'./src/components/terminal/TerminalMobileHeader';import{MobileNav}from'./src/components/shell/MobileNav';import{ProjectCard}from'./src/components/control/ProjectCard';import{FleetProjectRoute}from'./src/components/projects/FleetProjectRoute';import{FleetSurfaceGuide}from'./src/components/shell/FleetSurfaceGuide';
      const p={id:'project',projectId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',tab:'petvity',liveTab:null,dir:'/tmp/petvity',agentPref:'claude',modelPref:null,session:null,git:null,sessionLifecycleSignals:true,agentRunning:false,verifiedRunActive:false,activeAgents:[],profile:null,currentPrompt:null,readyAt:null,lockAt:null,closingAt:null,closedAt:null,recentCustomPrompts:[],recentActivity:[],recentOutcomes:[],liveAgentTurns:null,latestOrchestrationRun:null,autoInjectModeOverride:'off',autoContinueEnabled:true,promptQueue:[],promptQueueRevision:0};const root=createRoot(document.getElementById('app')); window.mount=(fixture)=>{window.fixture=fixture;window.fixturePath=fixture.context?'/projects/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/watch':'/terminal';root.render(<div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary"><div className="app-main-column"><div className="ui-app-topbar" style={{height:48}}>Loki</div>{fixture.context&&<FleetSurfaceGuide/>}<main className="app-main"><div className="app-page app-viewport-pane flex flex-col" data-fc-place="tab"><TerminalMobileHeader title="Petvity" state="live" agent="Claude" onOpenSheet={()=>{}} immersive={false} onToggleImmersive={()=>{}} view="chat" onViewChange={()=>{}}/>{fixture.context?<FleetProjectRoute pathname={window.fixturePath} project="loki"/>:fixture.card?<ProjectCard key={fixture.key} project={p} prompts={[]} liveTabs={[]} currentAdapter="claude" availableAgents={[{id:"claude",label:"Claude",modelSuggestions:[]}]} onInject={async()=>{}} onRunWithBrain={async()=>{}} onRunCustomPrompt={async()=>{}} automationMode="on" nowS={Date.now()/1000}/>:fixture.watch?<ProjectWatchLive key={fixture.key} phase="waiting" projectId="example" provider="Grok" startedAt={null} finishedAt={null} screen={null} fallbackHeadline="Queued" tab={null} terminalHref={null} autopilot={{override:null,inherited:'on'}} track={fixture.track??null} follow={null} walkthrough={null}/>:<ClaudeChatView key={fixture.key} tab="petvity" channel="cloud" onLive={state=>{window.streamState=state}} onKey={async bytes=>{if(window.failSend)throw Error('offline');window.written.push(bytes)}} onShowTerminal={()=>{window.openedTerminal=true}} onExplain={()=>{window.explained=true}}/>}</div></main></div><MobileNav/></div>)};window.written=[];`,
    },
    metafile: true,
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
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "js",
            contents: args.path.includes("use-claude-transcript")
              ? "export const useClaudeTranscript=()=>window.fixture"
              : args.path.includes("use-watch-narration")
                ? "export const useWatchNarration=()=>[]"
                : "export const usePathname=()=>window.fixturePath||'/terminal';export const useRouter=()=>({push(){},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();",
          }));
        },
      },
    ],
  });
  assert.deepEqual(
    Object.entries(bundle.metafile!.inputs)
      .filter(([, v]) => v.imports.some((i) => i.path.endsWith("next/server.js")))
      .map(([k]) => k),
    [],
    "Client controls and composer attachment schemas cannot pull in the Next server runtime",
  );
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error("Fixture page error:", e.message);
      });
      await page.route("**/*", (route) =>
        route.fulfill(
          route.request().url().includes("/api/")
            ? { contentType: "application/json", body: "{}" }
            : {
                contentType: "text/html",
                body: `<style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
              },
        ),
      );
      await page.goto("http://terminal.fixture/terminal");
      await page.evaluate(() => {
        Object.assign(window, { process: { env: { NODE_ENV: "production" } } });
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const packet =
        '<pasted_content id="sample">\n# Loki operator dispatch\nInternal framing.\n\n## The operator\'s goals & deadlines\nPrivate goal.\n\n## Your task (direct operator instruction)\nFix the homepage spacing.\n\n## Exit contract\nInternal handoff.\n</pasted_content>';
      const now = new Date().toISOString();
      const tool = {
        id: "tool",
        kind: "tool",
        at: now,
        name: "Bash",
        summary: "sleep 120",
        status: "running",
        result: null,
      };
      const mount = async (key: string, items: unknown[], extra = {}) => {
        await page.evaluate(
          (f) => (window as unknown as { mount: (x: unknown) => void }).mount(f),
          { key, items, connected: true, received: true, sessionId: "session", ...extra },
        );
      };
      await mount("packet", [{ id: "u", kind: "user", at: now, text: packet }, tool]);
      await page.getByText("Fix the homepage spacing.", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => (window as unknown as { streamState: string }).streamState),
        "live",
      );
      assert.equal(await page.getByRole("button", { name: "Allow", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Always", exact: true }).count(), 0);
      assert(!(await page.locator("pre").isVisible()), "internal dispatch starts folded");
      fs.mkdirSync(".tmp/mobile-final-review", { recursive: true });
      await page.screenshot({ path: `.tmp/mobile-final-review/conversation-${width}.png` });
      await page.getByText("Dispatch details", { exact: true }).click();
      assert(await page.locator("pre").isVisible());
      await page.getByText("Dispatch details", { exact: true }).click();
      await page.getByRole("button", { name: "View terminal", exact: true }).click();
      assert(
        await page.evaluate(
          () => (window as unknown as { openedTerminal: boolean }).openedTerminal,
        ),
      );
      assert.equal(
        await page.evaluate(() => (window as unknown as { written: string[] }).written.length),
        0,
        "inspection cannot send blind permission digits",
      );
      // "What's going on?" is the first chip above the session box now — the
      // header's sparkle icon was a second door to the same question.
      await page.getByRole("button", { name: "What's going on?" }).click();
      assert(await page.evaluate(() => (window as unknown as { explained: boolean }).explained));
      await page.evaluate(() => {
        (window as unknown as { failSend: boolean }).failSend = true;
      });
      await page.locator("textarea").fill("Continue with the homepage fix");
      await page.getByRole("button", { name: /^Send/ }).click();
      await page.getByText(/Send was not confirmed/).waitFor();
      assert.equal(await page.locator("textarea").inputValue(), "Continue with the homepage fix");
      await page.evaluate(() => {
        (window as unknown as { failSend: boolean }).failSend = false;
      });
      await page.getByRole("button", { name: /^Send/ }).click();
      await page.waitForFunction(
        () => (window as unknown as { written: string[] }).written.at(-1) === "\r",
      );
      await mount("interrupted", [
        { ...tool, status: "error", result: "[Request interrupted by user for tool use]" },
        { id: "stop", kind: "user", at: now, text: "[Request interrupted by user for tool use]" },
      ]);
      await page.getByText("Stopped by you", { exact: true }).waitFor();
      await page.screenshot({ path: `.tmp/mobile-final-review/interrupted-${width}.png` });
      assert.equal(await page.getByText("failed", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Thinking…", { exact: true }).count(), 0);
      assert.equal(await page.locator("textarea").getAttribute("placeholder"), "Message Claude…");
      await mount("quiet", [{ ...tool, at: new Date(Date.now() - 22 * 60_000).toISOString() }]);
      await page.getByText("No recent update from the agent", { exact: true }).waitFor();
      await mount("disconnected", [tool], { connected: false });
      await page.getByText("Reconnecting to the session…", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => (window as unknown as { streamState: string }).streamState),
        "stalled",
      );
      await mount("queued", [], { watch: true });
      await page.getByRole("heading", { name: "Queued" }).waitFor();
      assert.equal(await page.getByText("Grok is working", { exact: false }).count(), 0);
      // The delivery track under the headline: the stage happening now wears
      // a running clock, and a tap on it opens the facts behind it.
      const askedAt = new Date(Date.now() - 65_000).toISOString();
      await mount("queued-track", [], {
        watch: true,
        track: {
          summary: "Waiting for a builder to pick it up — usually under a minute.",
          settled: false,
          current: "builder",
          stages: [
            {
              id: "asked",
              label: "You asked",
              state: "done",
              note: null,
              href: null,
              linkLabel: null,
              at: askedAt,
              facts: [{ text: "Sent to Grok.", at: askedAt }],
            },
            {
              id: "builder",
              label: "Waiting for a builder",
              state: "now",
              note: "Usually under a minute.",
              href: null,
              linkLabel: null,
              at: askedAt,
              facts: [{ text: "The job is on the queue; the next free builder claims it." }],
            },
            {
              id: "working",
              label: "Grok makes the change",
              state: "next",
              note: null,
              href: null,
              linkLabel: null,
              at: null,
              facts: [],
            },
            {
              id: "pr",
              label: "Pull request",
              state: "next",
              note: null,
              href: null,
              linkLabel: null,
              at: null,
              facts: [],
            },
            {
              id: "merged",
              label: "Checks and merge",
              state: "next",
              note: null,
              href: null,
              linkLabel: null,
              at: null,
              facts: [],
            },
            {
              id: "live",
              label: "Live",
              state: "next",
              note: null,
              href: null,
              linkLabel: null,
              at: null,
              facts: [],
            },
          ],
        },
      });
      await page.getByRole("heading", { name: /Waiting for a builder to pick it up/ }).waitFor();
      await page.locator(".ui-track-clock").waitFor();
      assert.match(await page.locator(".ui-track-clock").innerText(), /^1m 0\ds$/);
      await page.getByRole("button", { name: /Waiting for a builder/ }).click();
      await page.getByText("The job is on the queue", { exact: false }).waitFor();
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
      await mount("queued", [], { watch: true });
      await page.getByRole("heading", { name: "Queued" }).waitFor();
      await page.getByRole("button", { name: "Autopilot on", exact: true }).click();
      await page.getByRole("button", { name: "Autopilot paused", exact: true }).waitFor();
      await page
        .getByText("Autopilot is paused — it finishes this, then waits for you.", { exact: true })
        .waitFor();
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
      await mount("control", [], { card: true });
      await page.getByRole("button", { name: "Autopilot paused", exact: true }).waitFor();
      await page
        .getByText("Autopilot off: this project waits for your instruction.", { exact: true })
        .waitFor();
      assert(!(await page.locator("body").innerText()).includes("Autopilot on:"));
      await page.getByRole("button", { name: "Autopilot paused", exact: true }).click();
      await page.getByRole("button", { name: "Autopilot on", exact: true }).waitFor();
      await page.getByText(/Autopilot on: queue is empty/).waitFor();
      await page.evaluate(() => localStorage.setItem("loki:active-project", "petvity"));
      await mount("context", [], { context: true });
      await page.locator('a[href="/control?focus=loki"]').waitFor();
      assert.equal(await page.locator('a[href="/control?focus=petvity"]').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `✓ ${width}px: folded dispatch, honest interruption/queue state, no guessed approvals, retained failed draft and consistent autopilot`,
      );
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
