/**
 * The pre-commit hook's pathspec actually reaches the files in this repo.
 * Run: npx tsx scripts/test/precommit-pathspec.ts
 *
 * The class this closes: a hook that lints nothing and says so reassuringly.
 * `.husky/pre-commit` held
 *
 *     GLOBS="src/**\/*.ts src/**\/*.tsx home/**\/*.ts home/**\/*.tsx"
 *     git diff --cached --name-only $FILTER -- $GLOBS
 *
 * and because `$GLOBS` is unquoted the SHELL expands it before git sees it.
 * POSIX sh has no globstar, so `**` collapses to one level: the variable became
 * 230 literal paths, all exactly two levels deep, and nothing deeper could ever
 * match. Almost all code here is deeper than that. Measured 2026-08-27 on a
 * commit touching 10 TypeScript files: it matched 0 and printed "no staged
 * TypeScript — nothing to lint" — a statement about its own pathspec dressed up
 * as a statement about the commit.
 *
 * This test is deliberately BEHAVIOURAL rather than a grep for `:(glob)`. It
 * re-runs the hook's own assignment in the same shell the hook uses and asks
 * git what it matches, so it stays honest no matter how the line is rewritten —
 * a grep would only prove today's fix is still spelled the same way.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const HOOK = ".husky/pre-commit";
const hook = readFileSync(HOOK, "utf8");

const globsLine = hook.split("\n").find((l) => /^GLOBS=/.test(l.trim()));
assert.ok(
  globsLine,
  `no GLOBS= assignment in ${HOOK} — the pathspec moved; update this test with it`,
);

// Same shell, same unquoted expansion the hook performs.
const matched = execFileSync("sh", ["-c", `${globsLine}\ngit ls-files -- $GLOBS`], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean);

// A floor: a pathspec matching nothing would otherwise satisfy every
// "contains" assertion below by vacuous truth in the wrong direction.
assert.ok(
  matched.length > 300,
  `the pre-commit pathspec matches only ${matched.length} file(s) — it is not reaching the tree`,
);

// The actual regression: files more than two directories deep. This is where
// almost all of src/ lives, and it is exactly what the broken form missed.
const deep = matched.filter((f) => f.startsWith("src/") && f.split("/").length >= 4);
assert.ok(
  deep.length > 100,
  `the pre-commit pathspec matches ${deep.length} deep src/ file(s) — ` +
    `it is only reaching shallow paths, which is the shell-globstar bug returning. ` +
    `Keep the ':(glob)' prefix so git, not the shell, interprets '**'.`,
);

// Both roots the hook claims to cover must actually be covered.
for (const root of ["src/", "home/"]) {
  assert.ok(
    matched.some((f) => f.startsWith(root)),
    `the pre-commit pathspec matches no ${root} files, though the hook lists it`,
  );
}

// And a file we know is deep — named, so a future reshuffle that quietly stops
// covering API routes is loud rather than absorbed by the counts above.
const sentinel = "src/app/api/crons/reap-stale-runs/route.ts";
assert.ok(
  matched.includes(sentinel),
  `the pre-commit pathspec does not match ${sentinel} (5 levels deep) — deep routes are unlinted`,
);

console.log(
  `✓ pre-commit pathspec: ${matched.length} file(s) reachable, ${deep.length} of them deeper than two levels`,
);
