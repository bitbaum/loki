/**
 * The pre-push smoke must not run against a server it cannot smoke.
 *
 * "Is this Loki?" was answered by the presence of a `commit` field in
 * /api/health. A Loki process started without DATABASE_URL satisfies that
 * perfectly — it answers health and 404s every database-backed route. So the
 * hook smoked it and failed 23 of 48 routes, on changes that could not
 * possibly have caused it: CSS, one copy string, a sort comparator.
 *
 * Observed twice on 2026-09-22. Both pushes went out `--no-verify` and CI
 * passed the identical bundle each time.
 *
 * That is the worst shape a gate can take. It blocks correct work, names the
 * wrong cause, and teaches you to bypass it — after which it protects nothing.
 * The health payload already reports `schema.state`, so the hook had the fact
 * it needed and simply never looked at it.
 *
 * This test drives the real decision the hook makes, with the real payloads.
 *
 * Run: npx tsx scripts/test/pre-push-skips-a-server-it-cannot-smoke.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const HOOK = join(process.cwd(), ".husky/pre-push");
const hook = readFileSync(HOOK, "utf8");
// The comment block quotes the payload under test; scanning it would let the
// file pass on its own prose.
const code = hook.replace(/^\s*#.*$/gm, "");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** The exact payloads, copied from real servers. */
const UNCONFIGURED = '{"ok":true,"commit":"e570b27","schema":{"state":"unconfigured"}}';
const HEALTHY =
  '{"ok":true,"runtime":false,"version":null,"commit":"6beb7be2","env":{"healthy":true}}';
const NOT_LOKI = '{"status":"ok","service":"something-else"}';

/**
 * The hook's decision, as the shell expresses it: which branch does a given
 * payload take? Mirrors the grep conditions rather than re-implementing them,
 * so the test fails if the shell's own tests are reworded.
 */
function branchFor(health: string): "no-server" | "not-loki" | "unconfigured" | "smoke" {
  if (!health) return "no-server";
  if (!health.includes('"commit"')) return "not-loki";
  if (health.includes('"state":"unconfigured"')) return "unconfigured";
  return "smoke";
}

console.log("pre-push-skips-a-server-it-cannot-smoke:");

check("THE BUG: a database-less server is not smoked", () => {
  assert(
    branchFor(UNCONFIGURED) === "unconfigured",
    "a server with no database would still be smoked — 23/48 routes 404 regardless of the change",
  );
});

check("the hook actually tests for it", () => {
  assert(
    code.includes('"state":"unconfigured"'),
    "the hook does not inspect schema.state, so it cannot tell a broken server from a working one",
  );
});

check("and it skips rather than fails", () => {
  // Skipping is right: the server's state is not the pusher's problem. Failing
  // here is what taught everyone to reach for --no-verify.
  const at = code.indexOf('"state":"unconfigured"');
  const branch = code.slice(at, code.indexOf("else", at));
  assert(
    /skipping/i.test(branch),
    `the unconfigured branch does not say it is skipping: ${branch.slice(0, 120)}`,
  );
  assert(
    !/\bexit 1\b/.test(branch) && !/pnpm run smoke/.test(branch),
    "the unconfigured branch still runs the smoke or fails the push",
  );
});

check("a healthy server is STILL smoked — the gate is not disarmed", () => {
  assert(
    branchFor(HEALTHY) === "smoke",
    "a real server stopped being smoked; this fix must narrow the skip, not remove the check",
  );
  assert(code.includes("pnpm run smoke"), "the smoke step is gone entirely");
});

check("no server, and a non-Loki server, still skip as before", () => {
  assert(branchFor("") === "no-server", "the not-running branch changed");
  assert(branchFor(NOT_LOKI) === "not-loki", "the not-Loki branch changed");
});

check("the skip names the cause and the cure", () => {
  // A skip nobody understands becomes a mystery next time. It has to say WHY
  // and what to type.
  const at = code.indexOf('"state":"unconfigured"');
  const branch = code.slice(at, code.indexOf("else", at));
  assert(/database/i.test(branch), "the message does not say the database is missing");
  assert(/db:push/.test(branch), "the message does not say how to fix it");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
