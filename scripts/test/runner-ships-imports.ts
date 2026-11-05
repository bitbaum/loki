/**
 * Every file the box-runner's entrypoints can load must be one the deploy ships.
 *
 * /opt/loki/runner is not a checkout: it holds exactly what deploy-hetzner.sh
 * rsyncs into it (src/, home/, desktop/src/, a list of scripts, …). An import
 * that reaches outside that set works on every laptop and in CI, and dies on the
 * box with MODULE_NOT_FOUND at the next run. Observed 2026-11-05: loki-reindex
 * failed on scripts/reindex-knowledge.ts → … → src/lib/feedback/tour-token.ts →
 * widget/tour, because widget/ had never been shipped to the runner.
 *
 * This walks the static import graph from each runner entrypoint (relative and
 * `@/` imports; type-only imports are erased by tsx and skipped) and asserts
 * every reached file is covered by a sync_runner line in the deploy.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = join(__dirname, "..", "..");
const deploy = readFileSync(join(root, "scripts/deploy-hetzner.sh"), "utf8");

/** Repo-relative paths the deploy ships: dirs end in "/", files do not. */
function shippedPaths(): string[] {
  const joined = deploy.replace(/\\\n/g, " ");
  const out: string[] = [];
  for (const line of joined.split("\n")) {
    if (!/^\s*sync_runner\s/.test(line)) continue;
    for (const m of line.matchAll(/"\$PROJECT_DIR\/([^"]+)"/g)) out.push(m[1]);
  }
  return out;
}

const shipped = shippedPaths();
const isShipped = (rel: string) =>
  shipped.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));

/** The runner's entrypoints: every scripts/*.ts the deploy ships. */
const entrypoints = shipped.filter((p) => /^scripts\/[^/]+\.ts$/.test(p));

const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];
function resolveFile(base: string): string | null {
  for (const ext of EXTS) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']|(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

function deps(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    if (m[1]) continue; // `import type` / `export type` — erased at runtime
    const spec = m[2] ?? m[3];
    let base: string | null = null;
    if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(file), spec);
    else if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2));
    if (!base) continue; // a package or node: builtin — the manifest's job
    const hit = resolveFile(base);
    if (hit) out.push(hit);
  }
  return out;
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("the deploy ships runner entrypoints to walk from", () => {
  for (const e of ["scripts/box-runner.ts", "scripts/reindex-knowledge.ts"]) {
    if (!entrypoints.includes(e)) throw new Error(`${e} is no longer shipped by deploy-hetzner.sh`);
  }
});

check("every file a runner entrypoint can import is shipped to /opt/loki/runner", () => {
  const seen = new Map<string, string>(); // file → the file that first imported it
  const queue = entrypoints.map((e) => join(root, e));
  for (const e of queue) seen.set(e, "(entrypoint)");
  while (queue.length) {
    const f = queue.pop()!;
    for (const d of deps(f)) {
      if (seen.has(d)) continue;
      seen.set(d, f);
      queue.push(d);
    }
  }
  const missing = [...seen.keys()]
    .map((f) => relative(root, f))
    .filter((rel) => !isShipped(rel))
    .map((rel) => `${rel}  (imported by ${relative(root, seen.get(join(root, rel))!)})`);
  if (missing.length) {
    throw new Error(
      `the runner would hit MODULE_NOT_FOUND — add a sync_runner line in scripts/deploy-hetzner.sh for:\n    ${missing.join("\n    ")}`,
    );
  }
  if (seen.size < 50) throw new Error(`walked only ${seen.size} files — the import scan is broken`);
});

console.log(`\nrunner-ships-imports: ${passed} passed`);
