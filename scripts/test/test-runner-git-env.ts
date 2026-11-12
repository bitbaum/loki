/**
 * The unit runner gives every test an environment with no pointer to a real
 * repository (scripts/test/lib/test-env.ts).
 *
 * On 2026-11-12 the pre-push hook, pushing from a linked worktree, ran
 * lane-base.ts with GIT_DIR set to the real repository. Its throwaway
 * `git init`, `git config` and "init" commit landed in the real one. This
 * replays the hazard between two throwaway repositories and checks the guard.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testEnv } from "./lib/test-env";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loki-runner-git-env-"));
const real = path.join(root, "real");
const sandbox = path.join(root, "sandbox");
fs.mkdirSync(real);
fs.mkdirSync(sandbox);

// A clean environment for setting up the stand-in for the real repository,
// whatever this process inherited.
const base = testEnv(process.env);
const git = (env: NodeJS.ProcessEnv, dir: string, args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { env, encoding: "utf8" }).trim();
git(base, real, ["init", "-q"]);

// What a hook hands down from a linked worktree: an absolute GIT_DIR.
const hooked = { ...base, GIT_DIR: path.join(real, ".git") };

// The hazard: the sandbox's own config write lands in the "real" repository.
git(hooked, sandbox, ["config", "user.name", "leaked"]);
assert.equal(
  git(base, real, ["config", "--local", "--get", "user.name"]),
  "leaked",
  "with GIT_DIR inherited, `git -C <sandbox>` writes the real repository",
);
git(base, real, ["config", "--local", "--unset", "user.name"]);

// The guard: the same steps under the runner's environment stay in the sandbox.
const guarded = testEnv(hooked);
assert.equal(guarded.GIT_DIR, undefined, "GIT_DIR is not passed to a test");
git(guarded, sandbox, ["init", "-q"]);
git(guarded, sandbox, ["config", "user.name", "sandboxed"]);
assert.equal(git(base, sandbox, ["config", "--local", "--get", "user.name"]), "sandboxed");
assert.throws(
  () => git(base, real, ["config", "--local", "--get", "user.name"]),
  "the real repository is untouched",
);
assert.equal(git(base, real, ["config", "--local", "--get", "core.bare"]), "false");

for (const name of ["GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
  assert.equal(testEnv({ [name]: "/x", PATH: process.env.PATH })[name], undefined, name);
}
assert.equal(testEnv({ HOME: "/h", PATH: process.env.PATH }).HOME, "/h", "everything else stays");

// And the runner uses it for every test it spawns.
const runner = fs.readFileSync("scripts/test-unit.ts", "utf8");
assert.match(runner, /const CHILD_ENV = testEnv\(\);/);
assert.match(runner, /env: CHILD_ENV,/);

fs.rmSync(root, { recursive: true, force: true });
console.log("test-runner-git-env ok");
