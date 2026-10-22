// The shared core of the page-render harnesses (REVIEW.md → "Definition of done
// for a page"): bundle a real component with esbuild, compile globals.css
// through @tailwindcss/postcss, load it in headless Chromium at phone and
// desktop widths in dark and light, and FAIL on horizontal overflow or a
// console error. Screenshots land in .tmp/<name>/ for a person to look at —
// this tool can see broken, never ugly.
//
// Each page has a thin script that calls renderPreview() with its entry file
// and the variants (URL queries) worth looking at. No database, no session, no
// dev server: the entry mocks `fetch` itself.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const postcss = require(
  require.resolve("postcss", { paths: [require.resolve("@tailwindcss/postcss")] }),
);
import tailwind from "@tailwindcss/postcss";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const FONT_VARS =
  ':root{--font-geist-sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--font-geist-mono:ui-monospace,SFMono-Regular,Menlo,monospace}';

/**
 * @param {{ entry: string, name: string, queries?: string[], outDir?: string,
 *           pageClass?: string }} opts
 *   entry   — path of the preview entry (relative to scripts/preview or absolute)
 *   name    — output folder under .tmp/ and the label in the log
 *   queries — URL queries to visit, "" for none
 */
export async function renderPreview({ entry, name, queries = [""], outDir }) {
  const out = resolve(outDir ?? resolve(root, ".tmp", name));
  mkdirSync(out, { recursive: true });

  await build({
    entryPoints: [resolve(here, entry)],
    bundle: true,
    format: "iife",
    outfile: resolve(out, "preview.js"),
    jsx: "automatic",
    tsconfig: resolve(root, "tsconfig.json"),
    alias: {
      "next/link": resolve(here, "shims/next-link.tsx"),
      "next/navigation": resolve(here, "shims/next-navigation.ts"),
    },
    // A pure module may `await import("undici")` or `import("node:dns")` on a
    // server-only path (lib/models/endpoint-guard.ts); the browser never
    // reaches it, so those stay outside the bundle instead of failing it.
    external: ["undici", "node:*"],
    define: { "process.env.NODE_ENV": '"development"' },
    // Shared config modules read process.env at import time; the browser has no
    // `process`, so give the bundle an empty one rather than patch app code.
    banner: { js: "window.process = window.process || { env: { NODE_ENV: 'development' } };" },
    logLevel: "warning",
  });

  const cssIn = resolve(root, "src/app/globals.css");
  // A package's stylesheet that is not installed here (a git dependency this
  // sandbox cannot fetch) must not stop a LAYOUT check of this repo's own
  // components: skip that one @import, loudly, and render with the rest.
  let cssText = readFileSync(cssIn, "utf8");
  cssText = cssText.replace(/^@import\s+["']([^"'.][^"']*)["'][^;]*;\s*$/gm, (line, spec) => {
    const parts = spec.split("/");
    const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (existsSync(resolve(root, "node_modules", pkg))) return line;
    console.warn(`harness: skipping @import "${spec}" (not installed here); its styles are absent`);
    return "";
  });
  const css = await postcss([tailwind({ base: root })]).process(cssText, {
    from: cssIn,
    to: resolve(out, "app.css"),
  });
  writeFileSync(resolve(out, "app.css"), css.css);

  for (const theme of ["dark", "light"]) {
    writeFileSync(
      resolve(out, `index-${theme}.html`),
      `<!doctype html><html lang="en" class="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"><style>${FONT_VARS}</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`,
    );
  }

  // A sandbox that ships one Chromium for every Playwright version names it
  // here; everywhere else Playwright's own download is used.
  const browser = await chromium.launch({
    ...(process.env.PREVIEW_CHROMIUM ? { executablePath: process.env.PREVIEW_CHROMIUM } : {}),
  });
  const problems = [];
  for (const theme of ["dark", "light"]) {
    for (const [vp, width, height] of [
      ["phone", 390, 844],
      ["desktop", 1280, 900],
    ]) {
      for (const query of queries) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
        const errors = [];
        page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(pathToFileURL(resolve(out, `index-${theme}.html`)).href + query);
        await page.waitForTimeout(1200);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        const tag = `${theme}-${vp}${query ? "-" + query.replace(/[^a-z0-9]+/gi, "_") : ""}`;
        await page.screenshot({ path: resolve(out, `${tag}.png`), fullPage: true });
        if (overflow > 0) problems.push(`${tag}: horizontal overflow ${overflow}px`);
        for (const e of errors) problems.push(`${tag}: console error: ${e.slice(0, 200)}`);
        console.log(`${tag}: overflow=${overflow}px errors=${errors.length}`);
        await page.close();
      }
    }
  }
  await browser.close();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`ok → ${out}`);
}
