// Watchdog cleanup must preserve the checks' exit status even when a shell
// execs the sleep directly, leaving no child for pkill -P to find.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const hook = readFileSync(".husky/pre-push", "utf8");
const cleanup = hook.match(/^trap '(.*)' EXIT$/m)?.[1];
assert.ok(cleanup, "use the hook's actual cleanup, not a test copy");
const directory = mkdtempSync(join(tmpdir(), "loki-hook-cleanup-"));
for (const status of [0, 7]) {
  const script = `set -e
pkill() { return 1; }
kill() { return 1; }
_watchdog=unused
_changed="$BENCHMARK_CLEANUP_PATH"
trap '${cleanup}' EXIT
exit ${status}
`;
  const checked = spawnSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, BENCHMARK_CLEANUP_PATH: join(directory, "absent") },
  });
  assert.equal(checked.status, status, checked.stderr);
}
rmSync(directory, { recursive: true, force: true });
console.log("pre-push cleanup preserves success and failure when the timer is gone");
