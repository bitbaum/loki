/**
 * The box-runner is headless: nothing it imports may need Electron.
 *
 * scripts/box-runner.ts runs the desktop's own poller, pusher and token store
 * under plain Node on the box. On 2026-10-11 (#1152) the poller gained a
 * top-level import of browser-handoff.ts, which imports `electron`; the
 * runner died at load ("Cannot find module 'electron'") and systemd restarted
 * it 220 times before anyone outside the box saw it. Every cloud dispatch
 * queued behind it, and the owner, on another computer, could not build.
 *
 * This walks the STATIC import graph from the runner's entry (dynamic
 * `import()` is the sanctioned way to reach desktop-only code, and is not
 * followed) and fails on any desktop-only package in it. Pure: it reads files,
 * so it runs in the unit suite with no node_modules for Electron at all.
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = join(ROOT, "scripts", "box-runner.ts");
/** Packages that exist only inside the Electron app. */
const DESKTOP_ONLY = new Set([
  "electron",
  "electron-updater",
  "@electron-toolkit/utils",
  "@sentry/electron",
]);

/** Static import / export-from specifiers, type-only imports excluded. */
export function staticSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const from = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?[^'";]*?\sfrom\s+['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(from)) if (!m[2]) out.push(m[3]);
  const bare = /(?:^|[\n;])\s*import\s+['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(bare)) out.push(m[1]);
  return out;
}

function resolveLocal(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, "src", spec.slice(2))
    : spec.startsWith("@home/")
      ? join(ROOT, "home", spec.slice(6))
      : spec.startsWith(".")
        ? resolve(dirname(fromFile), spec)
        : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

/** Every desktop-only package reachable from `entry`, with the path that reaches it. */
export function desktopOnlyReach(entry: string): { pkg: string; via: string[] }[] {
  const seen = new Set<string>();
  const hits: { pkg: string; via: string[] }[] = [];
  const walk = (file: string, via: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
      const pkg =
        spec.startsWith("@") && !spec.startsWith("@/")
          ? spec.split("/").slice(0, 2).join("/")
          : spec.split("/")[0];
      if (DESKTOP_ONLY.has(pkg)) hits.push({ pkg, via: [...via, file.replace(`${ROOT}/`, "")] });
      const next = resolveLocal(spec, file);
      if (next) walk(next, [...via, file.replace(`${ROOT}/`, "")]);
    }
  };
  walk(entry, []);
  return hits;
}

let passed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) throw new Error(`✗ ${label}${detail ? `\n${detail}` : ""}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

// The parser sees what matters and ignores what does not.
check(
  "a top-level import is seen",
  staticSpecifiers("import { BrowserWindow } from 'electron'\n").includes("electron"),
);
check(
  "a type-only import is not",
  !staticSpecifiers("import type { X } from 'electron'\n").includes("electron"),
);
check(
  "a dynamic import is not",
  !staticSpecifiers("void import('./browser-handoff')\n").includes("./browser-handoff"),
);
check(
  "a commented import is not",
  !staticSpecifiers("// import x from 'electron'\n").includes("electron"),
);

const hits = desktopOnlyReach(ENTRY);
check(
  "nothing the box-runner loads statically needs Electron",
  hits.length === 0,
  hits.map((h) => `  ${h.pkg} via ${h.via.join(" → ")}`).join("\n"),
);

console.log(`\n${passed}/${passed} box-runner-headless checks passed`);
