/**
 * The client's seat, drawn: the change waiting for their "Make it live" sits
 * above the box on their project page, and the owner picks a client's changes
 * a month as one even row — on the invite and on each client in the roster.
 * Checked at phone and desk widths; screenshots in .tmp/client-seat/.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const READY = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CLIENT = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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
      import {MemberGuide} from './src/components/projects/MemberGuide';
      import {ProjectMembersPanel} from './src/components/projects/ProjectMembersPanel';
      const owner=new URLSearchParams(location.search).has('owner');
      createRoot(document.getElementById('app')).render(<main className="app-main"><div className="app-page space-y-5">{owner
        ? <ProjectMembersPanel projectId="${ID}" projectName="Bakery" defaultRole="client"/>
        : <MemberGuide projectId="${ID}" role="client" projectName="Bakery" ownerName="George" liveUrl="https://bakery.example" ownerPass={null} joined={false}
            allowance={{limit:20,left:17}} ready={[{id:"${READY}",suggestion:"Make the opening hours bigger and put them at the top of the home page, where people look first."}]}/>}</div></main>);`,
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
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "fx" }));
          b.onLoad({ filter: /.*/, namespace: "fx" }, () => ({
            loader: "js",
            contents:
              "export const useRouter=()=>({push(){},replace(){},refresh(){window.__refreshed=true},prefetch(){}}); export const usePathname=()=>'/projects'; export const useSearchParams=()=>new URLSearchParams();",
          }));
        },
      },
    ],
  });
  const out = path.resolve(".tmp/client-seat");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        (window as unknown as { process: unknown }).process = { env: { NODE_ENV: "production" } };
      });
      const sent: Array<{ method: string; path: string; body: unknown }> = [];
      await page.route("**/*", (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname.startsWith("/api/")) {
          sent.push({ method: req.method(), path: url.pathname, body: req.postDataJSON() });
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              live: false,
              link: "https://loki.example/invite/project/abc",
              canManage: true,
              role: "owner",
              members: [
                {
                  userId: CLIENT,
                  name: "Anna",
                  email: "anna@bakery.example",
                  role: "client",
                  monthlyChanges: 20,
                },
              ],
              invitations: [],
            }),
          });
        }
        return route.fulfill({
          contentType: "text/html",
          body: `<style>${styles.css}html,body{font-family:system-ui,sans-serif!important}</style><div id="app"></div>`,
        });
      });
      const noSideways = async (what: string) =>
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${what} at ${width}px: no sideways scroll`,
        );
      const oneRow = async (name: string) => {
        const ys = await page
          .getByRole("radiogroup", { name, exact: true })
          .getByRole("radio")
          .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        assert.equal(ys.length, 4, `${name}: four choices`);
        assert.equal(new Set(ys).size, 1, `${name} at ${width}px: one even row`);
      };

      // The client's page.
      await page.goto("http://seat.fixture/projects");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByText("Ready for you · 1").waitFor();
      await page.getByText("17 of 20 changes left this month.").waitFor();
      await noSideways("client page");
      await page.screenshot({ path: path.join(out, `client-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Make it live" }).click();
      await page.waitForFunction(() => (window as { __refreshed?: boolean }).__refreshed === true);
      assert.ok(
        sent.some((s) => s.method === "POST" && s.path === `/api/feedback/${READY}/live`),
        "Make it live asks the server",
      );

      // The owner's People panel.
      await page.goto("http://seat.fixture/projects?owner");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByText("Anna · Client · 20 a month").waitFor();
      await oneRow("Changes a month");
      await oneRow("Changes a month for Anna");
      await noSideways("people panel");
      await page.screenshot({ path: path.join(out, `owner-${width}.png`), fullPage: true });
      await page
        .getByRole("radiogroup", { name: "Changes a month for Anna" })
        .getByRole("radio", { name: "5", exact: true })
        .click();
      await expectSoon(() =>
        sent.some(
          (s) =>
            s.method === "PATCH" &&
            JSON.stringify(s.body) === JSON.stringify({ userId: CLIENT, monthlyChanges: 5 }),
        ),
      );
      await page.getByRole("button", { name: "Create invite link" }).click();
      await expectSoon(() =>
        sent.some(
          (s) =>
            s.method === "POST" &&
            (s.body as { role?: string; monthlyChanges?: number })?.role === "client" &&
            (s.body as { monthlyChanges?: number }).monthlyChanges === 20,
        ),
      );
      assert.deepEqual(errors, [], `no page errors at ${width}px`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("✓ client seat in the browser: Ready for you, Make it live, changes a month");
}

async function expectSoon(check: () => boolean) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("expected request was not sent");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
