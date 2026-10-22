/**
 * The terminal's sessions on a phone, in a real browser.
 *
 * Asked for from a phone (2026-10-17): several sessions open at once,
 * "nothing cluttered, nothing dysfunctional". They were a row of tabs in the
 * header until 2026-10-19, when the "+" beside them scrolled off the edge with
 * two open; now the header names the one you are in, as a chat app does, and
 * its name opens the rest. The rules a phone width can break:
 *   - the header is one line however many sessions are open, and says how many;
 *   - the session's whole name fits;
 *   - the sheet behind the name lists every session with what it is doing,
 *     switches with one tap, and starts a new one;
 *   - "New session" opens the start form, which names a busy project and
 *     offers a second session beside it, never a replacement.
 *
 * Screenshots go to .tmp/terminal-tabs/ for a person to look at.
 * Run: npx tsx scripts/test/terminal-tabs-browser.ts
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
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss") as (
    plugins: unknown[],
  ) => { process(css: string, options: { from: string }): Promise<{ css: string }> };
  const from = path.resolve("src/app/globals.css");
  const styles = await postcss([tailwind()]).process(fs.readFileSync(from, "utf8"), { from });
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
        import{TerminalMobileHeader}from'./src/components/terminal/TerminalMobileHeader';
        import{TerminalNewSessionSheet}from'./src/components/terminal/TerminalNewSessionSheet';
        import{TerminalSessionNotice}from'./src/components/terminal/TerminalSessionNotice';
        import{TerminalSessionSheet}from'./src/components/terminal/TerminalSessionSheet';
        const q=new URLSearchParams(location.search);
        const all=[{id:'substrata',label:'substrata',status:'working'},{id:'orangecat',label:'orangecat',status:'needs-you'},
          {id:'substrata~1a2b3c4d',label:'substrata 2',status:'done'},{id:'heidi',label:'heidi',status:'idle'}];
        function App(){
          if(q.has('empty'))return <main className="app-page app-page-compact"><TerminalMobileHeader title="Cloud builder" state="idle" builder="Cloud builder" sessionCount={0} backHref="/control" onOpenSheet={()=>{}} onOpenMore={()=>{}}/></main>;
          const sessions=all.slice(0,Number(q.get('n')||1));
          const [active,setActive]=useState(sessions[0].id);
          const [open,setOpen]=useState(q.has('new'));
          const [sheet,setSheet]=useState(false);
          window.__active=active;
          return <main className="app-page app-page-compact">
            <TerminalMobileHeader title={sessions.find(s=>s.id===active).label} agent="Claude" state="live"
              status={sessions.find(s=>s.id===active).status} builder="Cloud builder" sessionCount={sessions.length}
              backHref="/control" onOpenSheet={()=>setSheet(true)} onOpenMore={()=>{}}
              view="chat" onViewChange={()=>{}}/>
            {sheet&&<TerminalSessionSheet onClose={()=>setSheet(false)} source="cloud" sources={['cloud','machine']}
              onSourceChange={()=>{}} tabs={sessions.map(s=>({id:s.id,label:s.label,status:s.status}))} activeTab={active}
              onSelectTab={setActive} onCloseTab={()=>{}} onNewSession={()=>setOpen(true)} agents={[]} activeAgentId="claude"
              onSwitchAgent={()=>{}} switchingAgent={false} agentSwitchDisabledReason={null}/>}
            {q.has('notice')&&<TerminalSessionNotice tabs={sessions} onOpen={setActive}
              news={{statuses:{},notice:{tab:'orangecat',status:'needs-you'},dismissNotice(){}}}/>}
            {open&&<TerminalNewSessionSheet onClose={()=>setOpen(false)}
              projects={[{name:'substrata',dir:'/d/substrata',agentPref:null},{name:'orangecat',dir:'/d/orangecat',agentPref:null}]}
              agents={[{id:'claude',label:'Claude'}]} defaultAgent="claude" activeProject="substrata"
              channel="cloud" openTabs={sessions.map(s=>s.id)} onStarted={()=>{}} onOpenSession={setActive}/>}
          </main>;
        }
        createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "navigation-fixture",
        setup(b) {
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "navigation",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents:
              "export const useRouter=()=>({push(){},replace(){},refresh(){},back(){},prefetch(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>'/terminal';",
          }));
        },
      },
    ],
  });
  const shots = path.resolve(".tmp/terminal-tabs");
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 700 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        (window as unknown as { process: unknown }).process = { env: { NODE_ENV: "production" } };
      });
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
        }),
      );
      const mount = async (query: string) => {
        await page.goto(`http://tabs.fixture/terminal${query}`);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.locator(".ui-term-mhead").waitFor();
      };
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

      const headRows = () =>
        page
          .locator(".ui-term-mhead-row")
          .evaluate((e) => Math.round(e.getBoundingClientRect().height));

      // Nothing open: the title is the builder, and the line under it does
      // not say it twice.
      await mount("?empty=1");
      assert.equal(await page.locator(".ui-term-mhead-sub").count(), 0, "no repeated builder");

      // One session: the name, what runs it and where.
      await mount("?n=1");
      assert.equal(
        await page.locator(".ui-term-mhead-sub").textContent(),
        "Claude · cloud builder",
      );
      assert.equal(await overflow(), false);
      await page.screenshot({ path: path.join(shots, `${width}-one.png`) });

      // Four sessions: still one line, which says there are four.
      await mount("?n=4");
      assert.ok((await headRows()) <= 48, "the header stays one row with four sessions");
      assert.equal(
        await page.locator(".ui-term-mhead-sub").textContent(),
        "Claude · 4 sessions · cloud builder",
      );
      assert.equal(await overflow(), false, "nothing pushes the page sideways");
      const title = await page
        .locator(".ui-term-mhead-title")
        .evaluate((e) => ({ width: e.clientWidth, textWidth: e.scrollWidth }));
      assert(
        title.width >= title.textWidth,
        `the current session keeps its whole name (${title.width} < ${title.textWidth})`,
      );
      for (const name of ["Back to Home", /^More/])
        assert(
          (await page
            .getByRole(typeof name === "string" ? "link" : "button", { name })
            .boundingBox())!.height >= 44,
        );
      await page.screenshot({ path: path.join(shots, `${width}-four.png`) });

      // The name opens every session, each saying what it is doing; one tap
      // switches.
      await page.locator(".ui-term-mhead-btn").click();
      const sheet = page.getByRole("dialog", { name: "Sessions" });
      await sheet.getByRole("heading", { name: "Open now", exact: true }).waitFor();
      assert.equal(
        await sheet.getByText("needs you", { exact: true }).count(),
        1,
        "a session waiting says so",
      );
      await page.screenshot({ path: path.join(shots, `${width}-sheet.png`) });
      await sheet.getByRole("button", { name: /^orangecat/ }).click();
      assert.equal(
        await page.evaluate(() => (window as unknown as { __active: string }).__active),
        "orangecat",
      );
      assert.equal(await page.locator(".ui-term-mhead-title").textContent(), "orangecat");

      // And starts another.
      await page.locator(".ui-term-mhead-btn").click();
      await sheet.getByRole("button", { name: "New session" }).click();
      await page.getByRole("button", { name: "Start another session" }).waitFor();

      // News from another session: one line, with Open.
      await mount("?n=4&notice=1");
      await page.getByRole("status").getByText("needs you").waitFor();
      await page.getByRole("status").getByRole("button", { name: "Open" }).click();
      assert.equal(
        await page.evaluate(() => (window as unknown as { __active: string }).__active),
        "orangecat",
      );
      assert.equal(await overflow(), false);
      await page.screenshot({ path: path.join(shots, `${width}-notice.png`) });

      // "+" on a busy project offers a second session beside it.
      await mount("?n=2&new=1");
      await page.getByRole("dialog").waitFor();
      const text = await page.getByRole("dialog").innerText();
      assert(/already has a session/.test(text), "a busy project says so");
      assert.equal(await page.getByRole("button", { name: "Start another session" }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Go to its session" }).count(), 1);
      assert.equal(await overflow(), false);
      await page.screenshot({ path: path.join(shots, `${width}-new.png`) });

      assert.deepEqual(errors, []);
      console.log(
        `✓ ${width}px: one header line for one or four sessions, the sheet lists and switches them, and a second session beside a busy one`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
