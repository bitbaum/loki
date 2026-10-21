/**
 * A temporary chat is gone when the person leaves it, and never listed.
 *
 * The leave rule is pure (lib/loki/temporary-chat.ts); the rest is pinned by
 * reading the files that carry the promise: the create route accepts the
 * flag, the list query hides the flag, the sweep exists and has its timer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leavesTemporary, TEMPORARY_CHAT_MAX_AGE_MS } from "../../src/lib/loki/temporary-chat";

assert.equal(leavesTemporary("t", null, "t"), true, "new chat leaves it");
assert.equal(leavesTemporary("t", "other", "t"), true, "switching leaves it");
assert.equal(leavesTemporary(null, "t", "t"), false, "entering is not leaving");
assert.equal(leavesTemporary("t", "t", "t"), false, "staying is not leaving");
assert.equal(leavesTemporary("a", "b", null), false, "no temporary chat, nothing to delete");
assert.equal(leavesTemporary("a", null, "t"), false, "leaving another thread deletes nothing");
assert.equal(TEMPORARY_CHAT_MAX_AGE_MS, 24 * 60 * 60 * 1000);

const route = readFileSync("src/app/api/conversations/route.ts", "utf8");
assert.match(
  route,
  /ephemeral: z\.boolean\(\)\.default\(false\)/,
  "the create route takes the flag",
);
const queries = readFileSync("src/db/queries/conversations.ts", "utf8");
assert.match(queries, /eq\(conversations\.ephemeral, false\)/, "the list hides temporary chats");
assert.match(queries, /deleteStaleEphemeralConversations/, "the sweep's query exists");
const exportRoute = readFileSync("src/app/api/me/export/route.ts", "utf8");
assert.match(exportRoute, /eq\(conversations\.ephemeral, false\)/, "an export leaves them out");
const crons = readFileSync("scripts/install-hetzner-crons.sh", "utf8");
assert.match(crons, /\[sweep-temporary-chats\]=/, "the sweep has its timer");
const hook = readFileSync("src/hooks/use-temporary-chat.ts", "utf8");
assert.match(hook, /keepalive: true/, "a closed tab still sends the delete");
const workspace = readFileSync("src/components/loki/LokiWorkspace.tsx", "utf8");
assert.match(workspace, /ephemeral: temporary\.armed/, "the toggle reaches the create call");
assert.match(
  workspace,
  /temporary\.claim\(conversation\.id\)/,
  "a temporary thread never joins the rail",
);

console.log("loki-temporary-chat: ok");
