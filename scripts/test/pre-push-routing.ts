import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The pre-push hook must route each path to the suite that COVERS it.
 *
 * It did not. `scripts/test/` sat in the hook's `_ops` arm, and that was
 * backwards in both directions at once:
 *
 *   • `test:ops` runs `scripts/hetzner/test-*.sh` and nothing else. No file
 *     under scripts/test/ can affect its result — so editing a unit test ran
 *     eighteen Hetzner shell suites for no reason.
 *   • The unit suite (scripts/test-unit.ts, which GLOBS scripts/test/*.ts)
 *     lives in the `_app` arm, which scripts/test/ did not trigger. So a
 *     broken unit test added under scripts/test/ passed pre-push, because the
 *     hook never ran the suite that file is a member of.
 *
 * Both arms are now pointed at the right thing. This test pins that, because
 * the failure mode is invisible: a gate that runs the wrong suite still prints
 * a wall of green.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const hook = readFileSync(join(root, ".husky", "pre-push"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** The `touches '<regex>' && _<arm>=1` lines, as {arm: regex}. */
const arms: Record<string, string> = {};
for (const m of hook.matchAll(/touches\s+'([^']+)'\s+&&\s+_(\w+)=1/g)) arms[m[2]] = m[1];

for (const arm of ["app", "ops", "register"]) {
  assert.ok(arms[arm], `pre-push must classify an "_${arm}" arm`);
}

const matches = (arm: string, path: string) => new RegExp(arms[arm]).test(path);

// ── 1. A unit test routes to the suite that runs unit tests ──────────────────
const unitTests = readdirSync(join(here))
  .filter((f) => f.endsWith(".ts"))
  .slice(0, 5)
  .map((f) => `scripts/test/${f}`);
assert.ok(unitTests.length > 0, "there are .ts files under scripts/test/ to reason about");
for (const path of unitTests) {
  assert.ok(
    matches("app", path),
    `${path} is part of the unit suite, so it must trigger the _app arm — ` +
      `that is the arm that runs test:unit`,
  );
  assert.equal(
    matches("ops", path),
    false,
    `${path} cannot affect test:ops (which runs only scripts/hetzner/*.sh), ` +
      `so it must not trigger the _ops arm`,
  );
}
assert.ok(
  /pnpm run test:unit/.test(hook.slice(hook.indexOf('if [ -n "$_app" ]'))),
  "the _app arm must actually run test:unit",
);

// ── 2. test:ops really is hetzner-only — the premise above ───────────────────
const opsScript = pkg.scripts["test:ops"] ?? "";
const opsPaths = [...opsScript.matchAll(/(scripts\/[\w/-]+\.sh)/g)].map((m) => m[1]);
assert.ok(opsPaths.length > 0, "test:ops runs some scripts");
for (const p of opsPaths) {
  assert.ok(
    p.startsWith("scripts/hetzner/"),
    `test:ops runs ${p}, which is outside scripts/hetzner/. The hook's _ops arm ` +
      `is scoped to scripts/hetzner and scripts/site-template — widen it, or ` +
      `move the script.`,
  );
  assert.ok(
    matches("ops", p),
    `${p} is run by test:ops but does not trigger the _ops arm — editing it ` + `would not run it`,
  );
}

// ── 3. The gate shell scripts route to the arm that runs them ────────────────
const gateScripts = readdirSync(here)
  .filter((f) => f.endsWith("gate.sh"))
  .map((f) => `scripts/test/${f}`);
for (const path of gateScripts) {
  assert.ok(
    matches("register", path),
    `${path} is a register gate, so it must trigger the _register arm — the ` +
      `one that runs test:*-gate`,
  );
}

// ── 4. Nothing gated is left with no arm at all ──────────────────────────────
for (const path of ["src/app/page.tsx", "home/watcher.ts", "widget/main.ts"]) {
  assert.ok(matches("app", path), `${path} must trigger the _app arm`);
}

console.log(
  `✓ pre-push routing: ${unitTests.length} sampled unit tests → _app (runs test:unit), ` +
    `${opsPaths.length} ops scripts → _ops, ${gateScripts.length} gate scripts → _register`,
);
