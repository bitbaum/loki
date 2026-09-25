/**
 * No box timer spends the free AI tier. Ever.
 * Run: npx tsx scripts/test/no-free-background-ai.ts
 *
 * George, 2026-09-25: "background jobs should not exist if there is a free
 * tier only." The box's Groq / OpenRouter / Gemini keys are free tiers shared
 * by every app on it, and Loki's timers were spending them with nobody asking:
 * the frontier digest, the feedback digest, the event scout, the digest email,
 * a daily one-token probe per pinned model, the Definition-of-Done judge on
 * every run close, and a six-hourly e2e that sent a real chat turn.
 *
 * This walks the CALL graph, not the import graph, from every scheduled route
 * (`requireCronAuth` under api/crons) and every close path a machine drives.
 * Import reachability is useless here: `model-registry` imports a model-id
 * constant from `lib/groq`, so every module "reaches" the model layer. Instead
 * each file is split into its top-level declarations, and only the ones a
 * reached declaration names are followed — across files by imported name.
 * A reached declaration fails the test if it
 *   - posts to a model endpoint (`/chat/completions`, `/audio/transcriptions`), or
 *   - imports a completion helper from `@bitbaum/ai-kit`.
 *
 * `/embeddings` is deliberately not a sink: EMBEDDINGS_BASE_URL on the box is
 * the self-hosted server on 127.0.0.1, not a free tier.
 *
 * The walker is proven on a synthetic tree first, so a walker that finds
 * nothing cannot pass for a clean tree.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const MODEL_ENDPOINT = /["'`/](chat\/completions|audio\/transcriptions)\b/;
const AI_KIT_CALLS = /^(complete|completeStream|chat|chatStream|callChain|runChain)$/;

type Source = (path: string) => string | null;
type Binding = { spec: string; name: string }; // name "*" = the whole module

/** Top-level declarations of a file: name → its text. Comments stripped, so a
 *  comment that mentions `callGroqText` is not mistaken for a call. */
function declarations(code: string): Map<string, string> {
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const decl =
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
  const out = new Map<string, string>();
  let name: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (name) out.set(name, (out.get(name) ?? "") + body.join("\n"));
  };
  for (const line of clean.split("\n")) {
    const m = decl.exec(line);
    const boundary = m || /^(import|export\s*\{|export\s*\*)/.test(line);
    if (boundary) {
      flush();
      name = m ? m[1] : null;
      body = [];
    }
    if (name) body.push(line);
  }
  flush();
  return out;
}

/** Local name → where it comes from. Covers named, default, namespace, and
 *  re-exports (`export { a } from`, `export * from`). */
function bindings(code: string): { local: Map<string, Binding>; star: string[] } {
  const local = new Map<string, Binding>();
  const star: string[] = [];
  const re =
    /(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|export\s*\*\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) {
    if (m[5]) {
      star.push(m[5]);
      continue;
    }
    if (m[2]) continue; // type-only: erased, cannot call anything
    const spec = m[4];
    const clause = m[3].trim();
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns) local.set(ns[1], { spec, name: "*" });
    const def = /^([\w$]+)\s*(,|$)/.exec(clause);
    if (def && m[1] === "import") local.set(def[1], { spec, name: "default" });
    const named = /\{([\s\S]*)\}/.exec(clause);
    for (const part of named ? named[1].split(",") : []) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p || part.trim().startsWith("type ")) continue;
      const [orig, alias] = p.split(/\s+as\s+/).map((x) => x.trim());
      local.set(alias ?? orig, { spec, name: orig });
    }
  }
  return { local, star };
}

function resolveSpec(from: string, spec: string, read: Source): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = relative(ROOT, resolve(ROOT, dirname(from), spec));
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(c) && read(c) !== null) return c;
  }
  return null;
}

/** Every model call reachable from the given (file, name) roots, as
 *  "file#decl: why", with the chain that reached it. */
export function violations(roots: Array<[string, string]>, read: Source): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ file: string; name: string; via: string }> = roots.map(([file, name]) => ({
    file,
    name,
    via: `${file}#${name}`,
  }));
  const cache = new Map<string, { decls: Map<string, string>; b: ReturnType<typeof bindings> }>();
  const parse = (file: string) => {
    if (!cache.has(file)) {
      const code = read(file) ?? "";
      cache.set(file, { decls: declarations(code), b: bindings(code) });
    }
    return cache.get(file)!;
  };

  while (queue.length) {
    const { file, name, via } = queue.shift()!;
    const key = `${file}#${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { decls, b } = parse(file);

    const bodies: string[] = [];
    if (name === "*") bodies.push(...decls.values());
    else if (decls.has(name)) bodies.push(decls.get(name)!);
    else {
      // Not declared here: a re-export, named or `export *`.
      const re = b.local.get(name);
      const target = re ? resolveSpec(file, re.spec, read) : null;
      if (re && target) queue.push({ file: target, name: re.name, via: `${via} > ${target}` });
      for (const s of b.star) {
        const t = resolveSpec(file, s, read);
        if (t) queue.push({ file: t, name, via: `${via} > ${t}` });
      }
      continue;
    }

    for (const body of bodies) {
      if (MODEL_ENDPOINT.test(body)) problems.push(`${key}: calls a model endpoint (${via})`);
      const idents = new Set(body.match(/[A-Za-z_$][\w$]*/g) ?? []);
      for (const id of idents) {
        if (id !== name && decls.has(id)) {
          queue.push({ file, name: id, via: `${via} > ${id}` });
        }
        const bind = b.local.get(id);
        if (!bind) continue;
        if (bind.spec.startsWith("@bitbaum/ai-kit") && AI_KIT_CALLS.test(bind.name)) {
          problems.push(`${key}: calls ${bind.name} from ${bind.spec} (${via})`);
        }
        const target = resolveSpec(file, bind.spec, read);
        if (target)
          queue.push({ file: target, name: bind.name, via: `${via} > ${target}#${bind.name}` });
      }
      // import("…") inside a body loads the whole module.
      for (const m of body.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        const t = resolveSpec(file, m[1], read);
        if (t) queue.push({ file: t, name: "*", via: `${via} > ${t}` });
      }
    }
  }
  return [...new Set(problems)];
}

const fromDisk: Source = (path) => {
  const abs = join(ROOT, path);
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : null;
};

// ── 1. The walker can fail ────────────────────────────────────────────────────
{
  const tree: Record<string, string> = {
    "src/app/api/crons/x/route.ts": [
      'import { run } from "@/lib/job";',
      "export async function GET() { return run(); }",
    ].join("\n"),
    "src/lib/job.ts": [
      'import { MODEL_ID, callText } from "./llm";',
      "export const label = MODEL_ID;",
      "export async function run() { return helper(); }",
      "async function helper() { return callText(); }",
    ].join("\n"),
    "src/lib/llm.ts": [
      'export const MODEL_ID = "m";',
      "export async function callText() {",
      "  return fetch(`${base}/chat/completions`);",
      "}",
    ].join("\n"),
    // Only the constant is used from a module that also holds a model call:
    // must NOT be flagged — this is the case import-reachability gets wrong.
    "src/app/api/crons/y/route.ts": [
      'import { MODEL_ID } from "@/lib/llm";',
      "export async function GET() { return MODEL_ID; }",
    ].join("\n"),
    "src/app/api/crons/z/route.ts": [
      'import { complete as ask } from "@bitbaum/ai-kit";',
      "export async function GET() { return ask(); }",
    ].join("\n"),
    "src/app/api/crons/w/route.ts": [
      'export { run as GET } from "@/lib/job";',
      "// a comment naming callText must not count",
    ].join("\n"),
  };
  const read: Source = (p) => (p in tree ? tree[p] : null);
  const x = violations([["src/app/api/crons/x/route.ts", "GET"]], read);
  assert.ok(
    x.some((v) => v.startsWith("src/lib/llm.ts#callText")),
    `walker missed a two-hop model call: ${JSON.stringify(x)}`,
  );
  assert.deepEqual(violations([["src/app/api/crons/y/route.ts", "GET"]], read), []);
  const z = violations([["src/app/api/crons/z/route.ts", "GET"]], read);
  assert.ok(
    z.some((v) => v.includes("calls complete from @bitbaum/ai-kit")),
    JSON.stringify(z),
  );
  const w = violations([["src/app/api/crons/w/route.ts", "GET"]], read);
  assert.ok(
    w.some((v) => v.startsWith("src/lib/llm.ts#callText")),
    JSON.stringify(w),
  );
}

// ── 2. The real tree ──────────────────────────────────────────────────────────
const CRON_DIR = "src/app/api/crons";
const cronRoutes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `${CRON_DIR}/${e.name}/route.ts`)
  .filter((f) => existsSync(f) && readFileSync(f, "utf8").includes("requireCronAuth"));
assert.ok(
  cronRoutes.length >= 10,
  `found ${cronRoutes.length} cron routes — has the layout moved?`,
);

/** Machine-driven, beyond the cron routes: every way a run gets closed. A page
 *  poll (/api/control GET), a runner push (runtime-state) and the hourly sweep
 *  all end in gateAndCloseRun — none of them is a person asking. */
const BACKGROUND: Array<[string, string]> = [
  ["src/lib/orchestration/gate-and-close.ts", "gateAndCloseRun"],
  ["src/lib/orchestration/close-sweep.ts", "*"],
];

const roots: Array<[string, string]> = [
  ...cronRoutes.flatMap((f): Array<[string, string]> => [
    [f, "GET"],
    [f, "POST"],
  ]),
  ...BACKGROUND,
];
const found = violations(roots, fromDisk);
assert.deepEqual(
  found,
  [],
  `a scheduled or machine-driven path reaches a model call — the box's AI keys are ` +
    `free tiers shared by every app, and a timer may not spend them:\n  ${found.join("\n  ")}`,
);

// ── 3. The removed jobs stay removed ─────────────────────────────────────────
const installer = readFileSync("scripts/install-hetzner-crons.sh", "utf8");
for (const gone of ["frontier-digest", "feedback-digest", "scout-events"]) {
  assert.ok(!installer.includes(`[${gone}]=`), `${gone} is back on a timer`);
  assert.ok(!existsSync(`${CRON_DIR}/${gone}`), `${CRON_DIR}/${gone} is back`);
}
const e2e = readFileSync("scripts/hetzner/install-loki-e2e-watch.sh", "utf8");
assert.ok(
  !/\[Timer\]/.test(e2e),
  "install-loki-e2e-watch.sh writes a timer again — the e2e sends a real chat turn",
);

// ── 4. No render spends a call ───────────────────────────────────────────────
// The Watch nudge used to compose on mount. It may read its cache on mount; the
// compose request belongs to the click.
const nudge = readFileSync("src/components/today/LokiNudge.tsx", "utf8");
const effects = [...nudge.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map(
  (m) => m[1],
);
assert.ok(effects.length > 0, "LokiNudge has no effect to inspect — the check moved");
for (const e of effects) {
  assert.ok(!/postJson|fetch\(/.test(e), "LokiNudge calls the compose endpoint from an effect");
}

console.log(
  `✓ no free AI in the background: ${cronRoutes.length} cron routes + ${BACKGROUND.length} close paths walked, 0 model calls`,
);
