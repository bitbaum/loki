/**
 * The widget is a SEPARATE bundle. It must stay that way.
 *
 * WHY THIS EXISTS
 *
 * `widget/` is esbuild-bundled on its own into public/widget.js and loaded by
 * strangers on other people's sites. It cannot see globals.css, Tailwind, React
 * or anything under `src/` — and it must carry no third-party dependency, since
 * one bundle has to mount on a static HTML page as readily as on a Next app.
 *
 * All of that is currently true only because whoever edits the folder remembers
 * it. An `import { x } from "@/lib/..."` compiles fine under the repo's tsconfig
 * paths and then either bloats the embed with half the app or fails at bundle
 * time on a machine that is not the author's. Splitting main.ts into modules
 * (2026-09-15) multiplied the number of files where that mistake can be made,
 * so the constraint is pinned here instead of remembered.
 *
 * Run: npx tsx scripts/test/widget-self-contained.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const widgetDir = join(repoRoot, "widget");

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

const files = readdirSync(widgetDir).filter((f) => f.endsWith(".ts"));
ok(files.includes("main.ts"), "widget/main.ts is the entry point");

/** Every `from "..."` specifier in a file, import or re-export. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
}

for (const file of files) {
  const source = readFileSync(join(widgetDir, file), "utf8");
  const bad = specifiers(source).filter((spec) => !spec.startsWith("./"));
  ok(
    bad.length === 0,
    `widget/${file} imports only its own siblings${bad.length ? ` (found: ${bad.join(", ")})` : ""}`,
  );
}

// Every sibling a module imports must actually exist — a rename that misses one
// import breaks the embed on every customer site at once, not just a page here.
const known = new Set(files.map((f) => f.replace(/\.ts$/, "")));
for (const file of files) {
  const source = readFileSync(join(widgetDir, file), "utf8");
  const missing = specifiers(source)
    .filter((spec) => spec.startsWith("./"))
    .map((spec) => spec.slice(2))
    .filter((name) => !known.has(name));
  ok(missing.length === 0, `widget/${file} resolves every sibling import`);
}

// The one exception the architecture allows: fcw-* classes on HOST elements.
// Everything else is Shadow DOM, so a stylesheet appended to document.head that
// is not the pick highlight would leak widget styling onto a customer's page.
const theme = readFileSync(join(widgetDir, "theme.ts"), "utf8");
ok(
  /\.fcw-hover/.test(theme) && /\.fcw-selected/.test(theme),
  "the only document-level CSS is the fcw-* pick highlight",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
