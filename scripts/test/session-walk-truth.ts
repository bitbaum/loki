/**
 * The Session walk (docs/foundation/LOOP-WALK.md) says what the routes do.
 *
 * Traced 2026-11-12: the walk said a running session "gets the prompt typed
 * into it", while on the cloud builder tab-inject queues a task that waits
 * behind the project's open run, and answered only `ok`; a prompt for a plain
 * shell was queued and answered 200, then refused by the runner.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");
const inject = read("src/app/api/control/tab-inject/route.ts");

assert.ok(
  inject.indexOf("isShellTab(tab)") > -1 &&
    inject.indexOf("isShellTab(tab)") < inject.indexOf("stageAttachmentsForAgent("),
  "a prompt for a shell is refused before anything is staged or queued",
);
assert.match(inject, /status: 403/);

assert.match(
  inject,
  /findQueueBlockers\(\[runId\]\)/,
  "the hold is read from the gate's own predicate",
);
assert.match(inject, /waitingOn: \{/, "the same fields as /api/inject");
assert.match(inject, /queuedBehindSentence\(blocker\)/, "and the same sentence");
assert.equal(
  (inject.match(/await withHold\(/g) ?? []).length,
  3,
  "the dispatch, queued and repo-only answers all say when they wait",
);
assert.match(
  inject,
  /body\.mode === "pty"/,
  "a prompt typed into a live PTY here waits for nothing",
);

const walk = read("docs/foundation/LOOP-WALK.md");
assert.doesNotMatch(walk, /gets the prompt\s+typed into it/, "the old claim is gone");
assert.match(walk, /waitingOn/);
assert.doesNotMatch(walk, /heldBehind/);
assert.match(walk, /\\u001b\[200~/, "how to type a message mid-task");
assert.match(walk, /in lowercase/, "open-tabs names are lowercased by the runner");
assert.match(
  read("desktop/src/main/pty-runtime.ts"),
  /runner:\$\{tab\.toLowerCase\(\)\}/,
  "if the runner stops lowercasing, the walk's note goes",
);

console.log("session-walk-truth ok");
