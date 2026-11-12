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
// The live stream is still a browser's: it holds a viewer open on the runner.
assert.match(read("src/app/api/control/peek-stream/route.ts"), /getSessionUserId\(\)/);

console.log("agent-session-read ok");
