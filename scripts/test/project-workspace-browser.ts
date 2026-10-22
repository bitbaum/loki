import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

async function main() {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss") as (
    p: unknown[],
  ) => { process(css: string, options: { from: string }): Promise<{ css: string }> };
  const from = path.resolve("src/app/globals.css");
  const styles = await postcss([tailwind()]).process(fs.readFileSync(from, "utf8"), { from });
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "jsx",
      contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ProjectWorkspaceView} from './src/components/projects/ProjectWorkspaceView';
      import {ProjectSharePanel} from './src/components/projects/ProjectSharePanel';
      import {FleetSurfaceGuide} from './src/components/shell/FleetSurfaceGuide';
      import {MobileNav} from './src/components/shell/MobileNav';
      const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const query=new URLSearchParams(location.search); const shared=query.has('shared'); const role=query.get('role')||'viewer';
      const name=query.has('long')?'A project with a genuinely long name that must wrap on a phone':'Loki';
      const attrs={status:'production',mission:'Help people build useful software.',problem:'Working on software is fragmented.',solution:'One workspace from idea to working result.',customers:'People building projects.',next_step:'Simplify the first screen and make progress easy to follow.'};
      const dossier={detail:{project:{id,name,description:'Life OS + AI agent fleet command center — the capability layer of the two-product system. '+ 'A long project brief belongs with its story, rather than taking over every page. '.repeat(12),gitUrl:'https://github.com/bitbaum/loki'},attrs,attrMeta:{},linkedGoals:[],linkedJobs:[],resources:[],devLog:[],relations:[]},ownerId:'owner',readonly:shared,viewerRole:shared?role:'owner',canEditFeedback:!shared,state:null,activity:[],outcomes:[],runs:[{id:'run-1',startedAt:new Date(Date.now()-30000),finishedAt:null,state:'running',outcome:null,payload:{},intent:'custom'}],userProject:{id:'catalog',name:'loki',gitUrl:'https://github.com/bitbaum/loki',liveUrl:'https://loki.orangecat.ch',codeCustody:'loki',isActive:true,listedPublicly:true},orangecatLinks:[],orangecatFunding:null,commits:[],builtAtMs:Date.now()};
      createRoot(document.getElementById('app')).render(<div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary"><div className="app-main-column"><div className="ui-app-topbar" aria-hidden="true"></div><FleetSurfaceGuide/><main className="app-main"><ProjectWorkspaceView dossier={dossier} shareAction={<ProjectSharePanel projectId={id} initialShare={null}/>}/></main></div><MobileNav/></div>);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "server-boundary-fixture",
        setup(b) {
          b.onResolve({ filter: /^(?:os|path|node:fs|node:path)$/ }, (a) => ({
            path: a.path,
            namespace: "node-fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "node-fixture" }, () => ({
            loader: "js",
            contents:
              "export const join=(...parts)=>parts.join('/'); export const readFileSync=()=>''; export const homedir=()=>'/tmp'; export default {join};",
          }));
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "navigation",
            namespace: "fixture",
          }));
          b.onResolve(
            { filter: /^(?:@\/lib\/register\/apps-conf|@\/lib\/site-cd-local)$/ },
            (a) => ({ path: a.path, namespace: "fixture" }),
          );
          b.onResolve(
            {
              filter:
                /^(?:@\/components\/packages\/ProjectBuiltFrom|\.\/ProjectPlannedKits|\.\/KitPlanPreview)$/,
            },
            (a) => ({ path: a.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            loader: "js",
            contents:
              a.path === "navigation"
                ? "export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){}}); export const usePathname=()=>'/projects/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; export const useSearchParams=()=>new URLSearchParams(location.search);"
                : a.path.includes("apps-conf")
                  ? "export const readAppsConf=()=>[];"
                  : a.path.includes("site-cd-local")
                    ? "export const studioRepoRoot=()=>'/tmp';"
                    : "export const ProjectBuiltFrom=()=>null; export const ProjectPlannedKits=()=>null; export const KitPlanPreview=()=>null;",
          }));
        },
      },
    ],
  });
  const out = path.resolve(".tmp/project-workspace");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        (window as unknown as { process: unknown }).process = { env: { NODE_ENV: "production" } };
      });
      const asked: Array<{ text: string }> = [];
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/ask") && route.request().method() === "POST") {
          asked.push(route.request().postDataJSON());
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              building: true,
              say: "Loki is building it now. You will see it on loki.orangecat.ch when it is live, and George is told.",
              followPath: "/feedback/ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee/watch-fix",
            }),
          });
        }
        if (url.pathname.startsWith("/api/projects/") && route.request().method() === "PATCH")
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Simulated failed save" }),
          });
        if (url.pathname.startsWith("/api/"))
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              members: [],
              invitations: [],
              items: [],
              feedback: [],
              reports: [],
              events: [],
              goals: [],
              linked: false,
            }),
          });
        return route.fulfill({
          contentType: "text/html",
          body: `<style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
        });
      });
      const mount = async (query = "") => {
        await page.goto(
          "http://workspace.fixture/projects/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" + query,
        );
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.getByRole("heading", { level: 1 }).waitFor();
      };
      await mount();
      assert.equal(
        await page.getByRole("navigation", { name: "Project workspace views" }).count(),
        0,
        "no competing workspace strip",
      );
      assert.equal(await page.getByRole("heading", { name: "Queued for a builder" }).count(), 1);
      assert.equal(
        await page.getByRole("link", { name: "Ask Loki" }).getAttribute("href"),
        "/loki?project=loki",
      );
      assert.equal(
        await page.getByRole("link", { name: "Open the site", exact: true }).count(),
        1,
        "the live site is Overview's first row, not a third header button",
      );
      assert.equal(await page.locator('main [data-fc-place="tab"]').count(), 1);
      assert.equal(await page.getByText("STAGE", { exact: true }).isVisible(), false);
      assert.equal(
        await page.getByRole("heading", { name: "Agent and repository" }).isVisible(),
        false,
        "no second runtime card on Overview",
      );
      const statusBox = await page.locator(".ui-project-current-work").boundingBox();
      assert(
        statusBox && statusBox.y < 500,
        "current work is visible without scrolling past metadata",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      // On a phone the section is ONE button naming where you are, which
      // opens the rest as a sheet (design reset rule 7) — not a <select>.
      const LABELS: Record<string, string> = {
        now: "Overview",
        context: "Story",
        feedback: "Feedback",
        plan: "Plan",
        activity: "Activity",
        people: "People",
        settings: "Settings",
      };
      const sections = {
        button: () => page.getByRole("button", { name: /^Project section: / }),
        open: async () => {
          await sections.button().click();
          await page.getByRole("listbox").waitFor();
        },
        pick: async (id: string) => {
          await sections.open();
          await page.getByRole("option", { name: new RegExp(`^${LABELS[id]}`) }).click();
          await page.getByRole("listbox").waitFor({ state: "hidden" });
        },
        current: async () =>
          ((await sections.button().getAttribute("aria-label")) ?? "").replace(
            /^Project section: /,
            "",
          ),
      };
      if (width === 320) {
        await sections.open();
        assert.equal(
          await page.getByRole("option").count(),
          7,
          "all sections available without horizontal clipping",
        );
        await page.keyboard.press("Escape");
        await page.getByRole("listbox").waitFor({ state: "hidden" });
        await sections.pick("context");
        await page.getByRole("button", { name: "Rename the project" }).click();
        await page
          .getByRole("textbox", { name: "Project name", exact: true })
          .fill("Renamed draft");
        await page.getByRole("textbox", { name: "Project name", exact: true }).press("Enter");
        await page.getByRole("alert").filter({ hasText: "That name was not saved" }).waitFor();
        assert.equal(
          await page.getByRole("textbox", { name: "Project name", exact: true }).inputValue(),
          "Renamed draft",
        );
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByTitle("Edit description").click();
        const textarea = page.locator("#context textarea").first();
        await textarea.fill("Draft that must survive section changes.");
        await sections.pick("activity");
        await sections.pick("context");
        assert.equal(await textarea.inputValue(), "Draft that must survive section changes.");
        await page.keyboard.press("Escape");
        await sections.pick("settings");
        // Every action in a settings row is one shape: "Website", "Own
        // domain", "Share", "List publicly" were ghost text beside a bordered
        // "Open repository" and a bare pencil (owner, 2026-10-19).
        const shapes = await page.evaluate(() =>
          [...document.querySelectorAll(".ui-setting-actions :is(a, button)")]
            .filter((e) => !e.closest("[role=dialog]") && e.getClientRects().length > 0)
            .map((e) => {
              const s = getComputedStyle(e);
              return {
                label: (e.textContent ?? "").trim() || e.getAttribute("aria-label"),
                h: Math.round(e.getBoundingClientRect().height),
                border: s.borderTopWidth,
                radius: s.borderTopLeftRadius,
                size: s.fontSize,
              };
            }),
        );
        assert.ok(shapes.length >= 4, `settings actions found: ${JSON.stringify(shapes)}`);
        for (const key of ["h", "border", "radius", "size"] as const) {
          assert.equal(
            new Set(shapes.map((s) => s[key])).size,
            1,
            `every settings action shares one ${key}: ${JSON.stringify(shapes)}`,
          );
        }
        assert.ok(shapes[0]!.h >= 44, "and it is a finger's size");
        await page
          .locator(".ui-setting-rows")
          .last()
          .screenshot({ path: path.join(out, `${width}-settings-sharing.png`) });
        await page
          .locator(".ui-setting-rows")
          .first()
          .screenshot({ path: path.join(out, `${width}-settings-website.png`) });
      } else if (width === 1440) {
        await page.getByRole("tab", { name: "Story", exact: true }).click();
        await page.getByRole("tab", { name: "Story", exact: true }).press("End");
        assert.equal(
          await page
            .getByRole("tab", { name: "Settings", exact: true })
            .getAttribute("aria-selected"),
          "true",
        );
      }
      // Exercise stateful flows once at the narrowest width; every width still gets layout and theme checks.
      if (width === 320) {
        await page.getByRole("button", { name: "Share", exact: true }).click();
        await page.getByRole("dialog", { name: "Share project" }).waitFor();
        assert.equal(
          await page
            .getByRole("combobox", { name: "Audience" })
            .evaluate((e) => e === document.activeElement),
          true,
          "the dialog focuses its first setting while remembering the opener",
        );
        assert.equal(
          await page.getByRole("dialog").evaluate((e) => e.contains(document.activeElement)),
          true,
        );
        await page.getByRole("button", { name: "Close share panel" }).focus();
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await page
            .getByRole("button", { name: "Create link" })
            .evaluate((e) => e === document.activeElement),
          true,
          "Tab wraps inside the dialog",
        );

        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(
          await page
            .getByRole("button", { name: "Share", exact: true })
            .evaluate((e) => e === document.activeElement),
          true,
          "focus returns to the opener",
        );
        await mount("#feedback");
        await page.getByRole("tabpanel", { name: "Feedback" }).waitFor();
        await mount("?shared=1");
        assert.equal(await page.getByRole("link", { name: "Project settings" }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Make it happen" }).count(), 0);
        assert.equal(await page.getByText("Shared with you · Viewer").count(), 1, "names the role");
        assert.equal(await page.getByRole("link", { name: "Invite" }).count(), 0);
        assert.equal(
          await page.getByRole("link", { name: "Ask for a change" }).getAttribute("href"),
          "#ask",
          "a member asks on the page, not in a chat that runs in their own account",
        );
        await mount("?long=1");
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await mount();
      }
      if (width <= 390) {
        // A Builder on someone else's project asks for a change right here:
        // it is built on the owner's builder, and the page says so and links
        // the build. The chat this used to open told Manu to install the
        // desktop app (walk as Manu, 2026-10-18).
        await mount("?shared=1&role=editor");
        assert.equal(await page.getByText("Shared with you · Builder").count(), 1);
        assert.equal(await page.getByRole("link", { name: "Ask Loki" }).count(), 0);
        await sections.pick("activity");
        await page.getByRole("link", { name: "Ask for a change" }).click();
        const box = page.getByRole("textbox", { name: "Ask for a change to Loki" });
        await box.waitFor();
        await page.waitForFunction(() => {
          const r = document.getElementById("ask")?.getBoundingClientRect();
          return !!r && r.top >= 0 && r.top < innerHeight;
        });
        assert.match(
          await sections.current(),
          /^Overview/,
          "the box's section opens from any other",
        );
        await box.fill("Make the Log today link bigger");
        await page.keyboard.press("Enter");
        await page.getByText("Loki is building it now.", { exact: false }).waitFor();
        assert.deepEqual(asked, [{ text: "Make the Log today link bigger" }]);
        assert.equal(
          await page.getByRole("link", { name: "Follow it" }).getAttribute("href"),
          "/feedback/ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee/watch-fix",
        );
        assert.equal(await box.inputValue(), "", "a sent ask leaves the box empty");
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.screenshot({ path: path.join(out, `${width}-builder-asked.png`) });
        await mount();
      }
      if (width === 1440) await page.getByRole("tab", { name: "Overview", exact: true }).click();
      await page.mouse.move(0, 0);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
          theme,
        );
        await page.waitForFunction(() => {
          const action = Array.from(document.querySelectorAll("a")).find(
            (el) => el.textContent?.trim() === "Open the site",
          );
          const title = document.querySelector("h1");
          return (
            action && title && getComputedStyle(action).color === getComputedStyle(title).color
          );
        });
        assert.equal(
          await page
            .getByRole("link", { name: "Open the site", exact: true })
            .evaluate((e) => getComputedStyle(e).color),
          await page.locator("h1").evaluate((e) => getComputedStyle(e).color),
          "secondary actions inherit the correct theme contrast",
        );
        await page
          .locator(".ui-project-workspace")
          .screenshot({ path: path.join(out, `${width}-${theme}-workspace.png`) });
        await page.screenshot({ path: path.join(out, `${width}-${theme}.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `✓ ${width}px: hierarchy, section navigation, retained edits, sharing, deep links, and shared access`,
      );
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
