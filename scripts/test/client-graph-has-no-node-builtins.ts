// A browser bundle cannot contain `fs`. #900 imported one regex from
// agent-config.ts (which imports fs) into activity-status.ts (rendered by
// ControlPanel in the browser): tsc, lint and every unit test stayed green, and
// only `next build` on the deploy failed with "Can't resolve 'fs'" — so main
// stopped deploying and nothing in `verify` said so.
//
// This walks the RUNTIME import graph (type-only imports are erased and cannot
// pull anything in) from every "use client" module under src/ and fails when it
// reaches a Node builtin the browser build cannot provide. Next ships browser
// fallbacks for some (os, path, crypto, …) — those build, so they are not
// flagged — and a "use server" module is an RPC boundary, not bundled code.
// Run: npx tsx scripts/test/client-graph-has-no-node-builtins.ts
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { builtinModules } from "module";
import { dirname, join, relative, resolve } from "path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));
// Next.js's browser fallbacks (next/dist/build/webpack-config + turbopack's
// node polyfills): these resolve in a client bundle, so reaching one builds.
const BROWSER_POLYFILLED = new Set([
  "assert",
  "buffer",
  "constants",
  "crypto",
  "domain",
  "events",
  "http",
  "https",
  "os",
  "path",
  "process",
  "punycode",
  "querystring",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tty",
  "util",
  "vm",
  "zlib",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

// Runtime imports only: `import type …` and `export type …` are erased, and so
// is a braced list whose every member is `type X`.
const IMPORT_RE =
  /^\s*(import|export)\s+(?!type\s)([^'";]*?)\s*from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

function runtimeImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const clause = m[2];
    const spec = m[3] ?? m[4];
    if (!spec) continue;
    if (clause) {
      const braced = clause.match(/^\{([\s\S]*)\}$/);
      if (braced) {
        const members = braced[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (members.length && members.every((s) => s.startsWith("type "))) continue;
      }
    }
    specs.push(spec);
  }
  return specs;
}

function isUnbundlableBuiltin(spec: string): boolean {
  const name = spec.replace(/^node:/, "").split("/")[0];
  return BUILTINS.has(name) && !BROWSER_POLYFILLED.has(name);
}

const isServerModule = (file: string) => /^\s*["']use server["']/.test(readFileSync(file, "utf8"));

/** The chain from `entry` to the first Node builtin it reaches, or null. */
function builtinChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; path: string[] }[] = [{ file: entry, path: [entry] }];
  while (stack.length) {
    const { file, path } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file !== entry && isServerModule(file)) continue;
    for (const spec of runtimeImports(file)) {
      if (isUnbundlableBuiltin(spec)) return [...path, spec];
      const next = resolveLocal(spec, file);
      if (next && !seen.has(next)) stack.push({ file: next, path: [...path, next] });
    }
  }
  return null;
}

let fail = 0;
const clientFiles = walk(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
for (const f of clientFiles) {
  const chain = builtinChain(f);
  if (chain) {
    fail++;
    console.error(
      `✗ client module reaches a Node builtin:\n    ${chain.map((p) => (p.startsWith("/") ? relative(ROOT, p) : p)).join("\n  → ")}`,
    );
  }
}

// The guard must be able to fire: a chain the regexes cannot see is a gate that
// cannot fail. agent-config.ts imports fs directly, so it must be reported.
const probe = builtinChain(join(SRC, "lib/agent-config.ts"));
if (!probe) {
  fail++;
  console.error("✗ self-check: agent-config.ts imports fs but the walker did not see it");
}

console.log(
  `client-graph-has-no-node-builtins: ${clientFiles.length} client modules checked, ${fail} failed`,
);
if (fail > 0) process.exit(1);
