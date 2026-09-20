/**
 * Every internal path this repo FETCHES or LINKS must resolve to a real route.
 * Run: npx tsx scripts/test/internal-paths-resolve.ts
 *
 * The class this closes — and it is the one this repo keeps shipping:
 *
 *   A feature is retired. The visible half is deleted (the page, the endpoint).
 *   The callers are not. Nothing fails, because a caller referencing a deleted
 *   route is still perfectly valid TypeScript, still passes eslint, and still
 *   renders. The 404 arrives at runtime, usually into a `.catch(() => {})`.
 *
 * Measured on 2026-09-20, all from ONE retirement (2391c6f7, the beacon popup):
 *
 *   src/hooks/use-auto-continue.ts  POST /api/beacon/cancel        deleted
 *   scripts/beacon.py               GET  /api/beacon/{id}          deleted
 *   scripts/beacon.py               POST /api/beacon/window/show   deleted
 *   src/config/beacon.ts            link /beacon/live              deleted
 *
 * Every existing gate was blind to all four. `dead-exports-ratchet.ts` asks
 * whether a symbol is REFERENCED — these references exist, so they pass; the
 * dead code forms a self-consistent island that points at nothing. tsc cannot
 * type a string. And `scripts/smoke.sh` could not see it either, because the
 * auth middleware answers 401 before routing, so a deleted route probes
 * identically to a live one.
 *
 * This checks the OUTBOUND direction, which nothing else did: not "is this
 * route called?" but "does the thing this caller names still exist?".
 *
 * SCOPE — deliberately narrow, so it cannot cry wolf:
 *   • Only paths starting `/api/`, plus a small set of known page prefixes.
 *   • Only string and template literals. A path assembled from variables is
 *     invisible here, and that is fine — this is a ratchet, not a proof.
 *   • Template holes (`${x}`) match any single segment, like a [dynamic] one.
 *
 * If this fails, the fix is almost always to delete the caller, not to add the
 * route back.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const APP_DIR = "src/app";
const SCAN_ROOTS = ["src", "scripts", "widget", "home", "bridge", "desktop/src"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh"]);

/** Paths that are real but not served from src/app — proxied, external, or
 *  handled by middleware. Each needs a reason: an entry without one rots. */
const KNOWN_NON_APP_PATHS: Record<string, string> = {
  "/api/auth": "NextAuth catch-all — mounted by the [...nextauth] handler",
};

/**
 * Paths that are deliberately NOT routes: strings a test feeds to a matcher to
 * prove the matcher's own behaviour. Keyed by `file → path` so an entry cannot
 * quietly cover a real call somewhere else, and each carries its reason.
 */
const DELIBERATE_NON_ROUTES: Record<string, Record<string, string>> = {
  "scripts/test/demo-sandbox.ts": {
    "/api/controlled-substances":
      "fixture proving prefix matching is path-segment aware, not a bare startsWith",
    "/api/control/activity/capture": "fixture proving a carve-out covers sub-paths",
  },
};

function isDeliberate(file: string, path: string): boolean {
  return Boolean(DELIBERATE_NON_ROUTES[file.replace(/\\/g, "/")]?.[path]);
}

// ── Build the served route tree ──────────────────────────────────────────────
type Node = { children: Map<string, Node>; dynamic?: Node; catchAll?: boolean; serves: boolean };

function emptyNode(): Node {
  return { children: new Map(), serves: false };
}

const root = emptyNode();

function insert(segments: string[], serves: boolean) {
  let cur = root;
  for (const seg of segments) {
    if (seg.startsWith("(") && seg.endsWith(")")) continue; // route group — not in the URL
    if (seg.startsWith("@")) return; // parallel route slot
    if (seg.startsWith("[")) {
      if (seg.includes("...")) {
        cur.dynamic ??= emptyNode();
        cur.dynamic.catchAll = true;
        cur.dynamic.serves = true;
        return;
      }
      cur.dynamic ??= emptyNode();
      cur = cur.dynamic;
    } else {
      if (!cur.children.has(seg)) cur.children.set(seg, emptyNode());
      cur = cur.children.get(seg)!;
    }
  }
  if (serves) cur.serves = true;
}

function walkApp(dir: string, segs: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      walkApp(join(dir, e.name), [...segs, e.name]);
    } else if (/^(route|page)\.(ts|tsx|js|jsx)$/.test(e.name)) {
      insert(segs, true);
    }
  }
}
walkApp(APP_DIR, []);

/**
 * Can this path reach a served route?
 *
 * Two deliberate relaxations, both of which keep the check honest about
 * DELETIONS while refusing to cry wolf:
 *
 *  1. A `__dyn__` hole came from a template `${...}` and matches ANY child —
 *     literal or [dynamic] — because at runtime that variable holds a real
 *     segment name (`/api/projects/${id}/${kind}` where kind is "brief").
 *     So the question is "could this resolve?", not "must it?".
 *
 *  2. A path that is a strict PREFIX of a served route passes. Matcher and
 *     policy lists name prefixes on purpose — DEMO_DENIED_PREFIXES,
 *     robots.ts, the auth middleware. This still catches a retirement,
 *     because when the last route under a prefix goes, the prefix stops
 *     matching anything too.
 */
function search(node: Node, segs: string[], i: number, wantServe: boolean): boolean {
  if (node.catchAll) return true;
  if (i === segs.length) return wantServe ? node.serves : true;
  const seg = segs[i]!;
  if (seg === "__dyn__") {
    for (const child of node.children.values()) {
      if (search(child, segs, i + 1, wantServe)) return true;
    }
    return node.dynamic ? search(node.dynamic, segs, i + 1, wantServe) : false;
  }
  const literal = node.children.get(seg);
  if (literal && search(literal, segs, i + 1, wantServe)) return true;
  return node.dynamic ? search(node.dynamic, segs, i + 1, wantServe) : false;
}

function resolves(path: string): boolean {
  const clean = path.split("?")[0]!.split("#")[0]!;
  for (const known of Object.keys(KNOWN_NON_APP_PATHS)) {
    if (clean === known || clean.startsWith(known + "/")) return true;
  }
  const segs = clean.split("/").filter(Boolean);
  // Serves outright, or is a prefix of something that does.
  return search(root, segs, 0, true) || search(root, segs, 0, false);
}

// ── Collect referenced paths ─────────────────────────────────────────────────
// A template hole becomes a single wildcard segment, so `/api/x/${id}` probes
// the same shape the runtime would.
const PATH_RE = /["'`](\/(?:api|beacon)\/[A-Za-z0-9\-_/.$${}[\]]*)["'`]/g;

type Hit = { file: string; line: number; path: string };
const hits: Hit[] = [];

function scanFile(file: string) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|#|--)/.test(line)) return; // comment — documentation, not a call
    for (const m of line.matchAll(PATH_RE)) {
      const raw = m[1]!;
      if (raw.includes("*")) continue;
      const normalized = raw.replace(/\$\{[^}]*\}/g, "__dyn__").replace(/\/+$/, "");
      if (normalized.includes("${")) continue;
      hits.push({ file, line: i + 1, path: normalized });
    }
  });
}

function walkScan(dir: string) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "dist", "out", ".tmp", ".claude"].includes(e.name)) continue;
      walkScan(full);
    } else if (SCAN_EXT.has(extname(e.name))) {
      if (full.endsWith("scripts/test/internal-paths-resolve.ts")) continue; // this file's own examples
      scanFile(full);
    }
  }
}
for (const r of SCAN_ROOTS) walkScan(r);

const broken = hits.filter((h) => !resolves(h.path) && !isDeliberate(h.file, h.path));

const report = broken
  .map((b) => `  ${b.file}:${b.line}  →  ${b.path.replace(/__dyn__/g, "${…}")}`)
  .join("\n");

assert.equal(
  broken.length,
  0,
  `${broken.length} internal path reference(s) point at a route that does not exist:\n\n` +
    report +
    `\n\nThe caller outlived the route. Usually the fix is to delete the caller —` +
    ` a deleted endpoint is rarely meant to come back.\n`,
);

console.log(
  `✓ internal paths resolve: ${hits.length} reference(s) across ${SCAN_ROOTS.length} roots, 0 broken`,
);
