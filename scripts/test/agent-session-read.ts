/**
 * An agent that starts Claude Code in a Loki session can see it and read it.
 *
 * Starting (tab-inject), typing (tab-inject-raw) and closing (close-tab) took
 * a `ck_` token; listing open sessions and reading a capture took a browser
 * session only, so the agent could ask for a screen and never read the
 * answer. A plain shell stays a signed-in person's.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mayPeekTab } from "../../src/lib/peek-access";
import { shellTabFromHex } from "../../src/lib/shell-session";
import { terminalHref } from "../../src/lib/dispatch-card";

const read = (p: string) => fs.readFileSync(p, "utf8");
const shell = shellTabFromHex("0a1b2c3d");

assert.equal(mayPeekTab("loki", "token"), true, "an agent session is the token's to read");
assert.equal(mayPeekTab("loki", "session"), true);
assert.equal(mayPeekTab(shell, "token"), false, "a shell's screen is never a token's");
assert.equal(mayPeekTab(shell, "session"), true);

const list = read("src/app/api/control/open-tabs/route.ts");
assert.match(list, /getApiUserId\(\)/, "open sessions are listed for a token");
assert.doesNotMatch(list, /getSessionUserId/);

for (const route of [
  "src/app/api/control/peek-tab/route.ts",
  "src/app/api/control/peek-tab/[id]/route.ts",
]) {
  const src = read(route);
  assert.match(src, /getApiActor\(\)/, `${route}: session or token`);
  assert.match(src, /mayPeekTab\(tab, actor\.via\)/, `${route}: shells stay out`);
  assert.doesNotMatch(src, /getSessionUserId/);
}
// The asking route says where the answer is and where a person opens the session.
const ask = read("src/app/api/control/peek-tab/route.ts");
assert.match(ask, /resultUrl: `\/api\/control\/peek-tab\/\$\{peekId\}`/);
assert.match(ask, /openUrl: terminalHref\(tab, channel \?\? null\)/);
assert.equal(terminalHref("loki", "cloud"), "/terminal?project=loki");
// The conversation: a token reads its sessions through the same reads as
// OrangeCat's signed rail, and neither route keeps a copy of its own.
const control = read("src/app/api/control/sessions/route.ts");
assert.match(control, /getApiUserId\(\)/, "sessions and their conversation are read with a token");
assert.match(control, /readSessions\(userId, parsed\.data\)/);
const signed = read("src/app/api/orangecat/sessions/route.ts");
assert.match(signed, /readSessions\(user\.id, \{ project, runId, items \}\)/);
for (const src of [control, signed]) {
  assert.doesNotMatch(src, /lastTranscript|addPeekViewer|loadRunTrack/, "one copy of the reads");
}
const reads = read("src/lib/session-reads.ts");
assert.match(reads, /export async function readSessions\(/);
assert.match(reads, /total: rows\.length,/, "a list cut at the cap says how many there were");
// The conversation read is current, on the session's builder, and shares the
// Terminal's viewer count (so it never ends a person's live view).
assert.match(reads, /readTranscript\(userId, tab, projectPreferredChannel\(project\)\)/);
assert.match(reads, /const command = \{ tab, channel \};/, "peek commands name the builder");
assert.match(reads, /addPeekViewer\(userId, tab, channel\)/);
assert.match(reads, /removePeekViewer\(userId, tab, channel\)/);
assert.match(reads, /frame\.at >= asked/, "a copy from before the read is not the answer");

// The live stream is still a browser's: it holds a viewer open on the runner.
assert.match(read("src/app/api/control/peek-stream/route.ts"), /getSessionUserId\(\)/);

console.log("agent-session-read ok");
