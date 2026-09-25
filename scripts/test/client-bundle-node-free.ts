/**
 * Nothing in the browser bundle imports a Node builtin Next cannot polyfill.
 *
 * WHY THIS EXISTS
 * ---------------
 * `verify` does not run `next build` (it needs a database and minutes), so a
 * client/server boundary break is invisible until the DEPLOY builds — after
 * the PR has merged. On 2026-09-25 loki#900 made activity-status.ts (shared
 * with client components) import from agent-config.ts, which imports `fs`.
 * Turbopack failed with "Module not found: Can't resolve 'fs'"; four deploys
 * of main were refused, and nothing merged after it could ship.
 *
 * HOW
 * ---
 * The same walk Turbopack does for the client graph, without building: start
 * at every "use client" module, follow static imports (`import type` is
 * erased, so skipped), and stop at "use server" modules — a client reaches
 * those only as RPC stubs. Any module reached that imports a builtin Next does
 * not polyfill for the browser is a build failure waiting for the deploy.
 * `path`, `os`, `crypto`, `util` and friends ARE polyfilled and are allowed.
 *
 * Proved against the real break: with #900's activity-status.ts restored this
 * reports exactly the two errors the deploy printed — `fs` in agent-config.ts
 * and in session-paths.ts, via activity-status.ts ← project-intent-panel.tsx.
 *
 * Run: npx tsx scripts/test/client-bundle-node-free.ts
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");

/** Builtins Next.js does not polyfill for the browser. */
const UNPOLYFILLED = new Set([
  "fs",
  "fs/promises",
  "child_process",
  "net",
  "tls",
  "dns",
  "worker_threads",
  "module",
  "readline",
  "cluster",
  "dgram",
  "v8",
  "perf_hooks",
  "inspector",
  "async_hooks",
  "http2",
  "repl",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package: not ours to walk
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const codeCache = new Map<string, string>();
function code(file: string): string {
  let c = codeCache.get(file);
  if (c === undefined) {
    c = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    codeCache.set(file, c);
  }
  return c;
}

/** Static value imports and re-exports; `import type` / `export type` are erased. */
function importsOf(file: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code(file)))) if (!m[1]) out.push(m[2]!);
  return out;
}

const directive = (file: string, name: string) =>
  new RegExp(`^\\s*["']${name}["']`).test(readFileSync(file, "utf8"));

const clientRoots = sourceFiles(SRC).filter((f) => directive(f, "use client"));
const parent = new Map<string, string | null>(clientRoots.map((f) => [f, null]));
const queue = [...clientRoots];
const violations: { file: string; builtin: string }[] = [];

while (queue.length) {
  const file = queue.shift()!;
  for (const spec of importsOf(file)) {
    const bare = spec.replace(/^node:/, "");
    if (UNPOLYFILLED.has(bare)) {
      violations.push({ file, builtin: spec });
      continue;
    }
    const next = resolveImport(file, spec);
    if (!next || parent.has(next) || directive(next, "use server")) continue;
    parent.set(next, file);
    queue.push(next);
  }
}

const rel = (p: string) => p.slice(ROOT.length + 1);
if (violations.length) {
  console.error(
    `✗ ${violations.length} Node builtin(s) reach the browser bundle — \`next build\` will fail at deploy:`,
  );
  for (const v of violations) {
    const chain: string[] = [];
    for (let f: string | null | undefined = v.file; f && chain.length < 8; f = parent.get(f)) {
      chain.push(rel(f));
    }
    console.error(`  '${v.builtin}' in ${chain.join("  ←  ")}`);
  }
  console.error(
    "\nFix: move what the client needs into a module with no Node imports (see src/lib/exit-contract.ts).",
  );
  process.exit(1);
}
console.log(
  `✓ client bundle is Node-free: ${clientRoots.length} client modules, ${parent.size} reachable, 0 unpolyfilled builtins`,
);
