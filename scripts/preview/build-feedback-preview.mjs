// Render the real /feedback inbox in a real browser with fixture data, at phone
// and desktop widths, in dark and light — and fail on horizontal overflow or a
// console error. Run: node scripts/preview/build-feedback-preview.mjs [outDir]
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const postcss = require(
  require.resolve("postcss", { paths: [require.resolve("@tailwindcss/postcss")] }),
);
import tailwind from "@tailwindcss/postcss";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = resolve(process.argv[2] ?? resolve(root, ".tmp/feedback-preview"));
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(here, "feedback-inbox.preview.tsx")],
  bundle: true,
  format: "iife",
  outfile: resolve(out, "preview.js"),
  jsx: "automatic",
  tsconfig: resolve(root, "tsconfig.json"),
  alias: {
    "next/link": resolve(here, "shims/next-link.tsx"),
    "next/navigation": resolve(here, "shims/next-navigation.ts"),
  },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
});

const cssIn = resolve(root, "src/app/globals.css");
const css = await postcss([tailwind({ base: root })]).process(readFileSync(cssIn, "utf8"), {
  from: cssIn,
  to: resolve(out, "app.css"),
});
writeFileSync(resolve(out, "app.css"), css.css);

for (const theme of ["dark", "light"]) {
  writeFileSync(
    resolve(out, `index-${theme}.html`),
    `<!doctype html><html lang="en" class="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"><style>:root{--font-geist-sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--font-geist-mono:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`,
  );
}

const browser = await chromium.launch();
const problems = [];
for (const theme of ["dark", "light"]) {
  for (const [name, width, height] of [
    ["phone", 390, 844],
    ["desktop", 1280, 900],
  ]) {
    for (const query of [
      "",
      "?project=petvity",
      "?project=" + "5936f8fb-7239-4942-a7a9-95f77e7cc322",
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(pathToFileURL(resolve(out, `index-${theme}.html`)).href + query);
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      const tag = `${theme}-${name}${query ? "-" + query.replace(/[^a-z0-9]+/gi, "_") : ""}`;
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
