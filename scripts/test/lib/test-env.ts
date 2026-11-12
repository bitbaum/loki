import { spawnSync } from "child_process";

/**
 * Every test runs with no pointer to a real repository.
 *
 * The husky pre-push hook runs this suite with git's hook environment, and
 * from a linked worktree GIT_DIR is absolute. An absolute GIT_DIR overrides
 * `git -C <sandbox>`, so a test that makes a throwaway repo writes into the
 * real one instead. On 2026-11-12 lane-base.ts did exactly that from a push:
 * its "init" commit (author test) replaced every file of the branch being
 * pushed, and its `git init` and `git config` set core.bare, core.hooksPath
 * /dev/null and user.name test on the real repository. worktree-workspace.ts
 * and the shell fixtures (scripts/test/lib/git-fixture-env.sh) each guarded
 * themselves; a new test did not, so the guard lives here, for every test.
 *
 * The list is git's own (`git rev-parse --local-env-vars`), so it cannot fall
 * behind a new variable; the fallback is the set those guards strip.
 */
function gitRepoEnvVars(): string[] {
  const asked = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  const listed = asked.status === 0 ? asked.stdout.split("\n").map((v) => v.trim()) : [];
  const fallback = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PREFIX",
  ];
  return [...new Set([...listed.filter(Boolean), ...fallback])];
}

export function testEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const name of gitRepoEnvVars()) delete clean[name];
  return clean;
}
