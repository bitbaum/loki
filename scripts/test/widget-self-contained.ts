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

// The panel may reach into chat/ for the seam alone: the types, the theme
// mapping and the loader's global name. Anything else there is the chatkit
// chunk, and importing it would pull preact and chatkit into every page load.
const SEAM = new Set(["./chat/contract", "./chat/theme"]);
for (const file of files) {
  const source = readFileSync(join(widgetDir, file), "utf8");
  const bad = specifiers(source).filter(
    (spec) => !spec.startsWith("./") || (spec.startsWith("./chat/") && !SEAM.has(spec)),
  );
  ok(
    bad.length === 0,
    `widget/${file} imports only its own siblings${bad.length ? ` (found: ${bad.join(", ")})` : ""}`,
  );
}

// Every sibling a module imports must actually exist — a rename that misses one
// import breaks the embed on every customer site at once, not just a page here.
const chatDir = join(widgetDir, "chat");
const chatFiles = readdirSync(chatDir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
const known = new Set([
  ...files.map((f) => f.replace(/\.ts$/, "")),
  ...chatFiles.map((f) => `chat/${f.replace(/\.tsx?$/, "")}`),
]);
for (const file of files) {
  const source = readFileSync(join(widgetDir, file), "utf8");
  const missing = specifiers(source)
    .filter((spec) => spec.startsWith("./"))
    .map((spec) => spec.slice(2))
    .filter((name) => !known.has(name));
  ok(missing.length === 0, `widget/${file} resolves every sibling import`);
}

// widget/chat/ is the separate chat chunk (public/widget-chat.js): the one
// place a dependency is allowed, and only the shared chat itself — React
// there is Preact at bundle time (scripts/build-widget-chat.ts). The seam
// files are bundled into the panel too, so they stay dependency-free.
const CHUNK_DEPS = new Set([
  "react",
  "react-dom/client",
  "@bitbaum/chatkit",
  "@bitbaum/chatkit/react",
  "@bitbaum/chatkit/styles/chat.css",
]);
for (const file of chatFiles) {
  const name = `chat/${file.replace(/\.tsx?$/, "")}`;
  const seam = SEAM.has(`./${name}`);
  const source = readFileSync(join(chatDir, file), "utf8");
  const bad = specifiers(source).filter((spec) => {
    if (spec.startsWith("./")) return !known.has(`chat/${spec.slice(2)}`);
    if (spec === "../theme") return false;
    return seam || !CHUNK_DEPS.has(spec);
  });
  ok(
    bad.length === 0,
    `widget/${name} imports only ${seam ? "siblings (it is bundled into the panel)" : "siblings and the shared chat"}${bad.length ? ` (found: ${bad.join(", ")})` : ""}`,
  );
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
