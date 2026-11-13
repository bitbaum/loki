/**
 * Where the server keeps its AI usage log (lib/ai/usage-dir).
 * Run: npx tsx scripts/test/usage-dir.ts
 */
import assert from "node:assert/strict";
import { adoptFleetUsageLog, BOX_USAGE_DIR, fleetUsageDir } from "@/lib/ai/usage-dir";

const yes = () => true;
const no = () => false;

assert.equal(fleetUsageDir({ AI_USAGE_DIR: " /x " }, no), "/x", "the variable wins");
assert.equal(
  fleetUsageDir({}, yes),
  BOX_USAGE_DIR,
  "unset, and the box has the directory: that is the log",
);
assert.equal(
  fleetUsageDir({}, no),
  null,
  "unset and no directory: there is no log, not an empty one",
);

const env: Record<string, string | undefined> = {};
adoptFleetUsageLog(env, yes);
assert.deepEqual(
  env,
  { AI_USAGE_DIR: BOX_USAGE_DIR, AI_APP_ID: "LOKI" },
  "Loki's own calls are named and logged",
);

const own: Record<string, string | undefined> = { AI_USAGE_DIR: "/mine", AI_APP_ID: "DEV" };
adoptFleetUsageLog(own, yes);
assert.deepEqual(own, { AI_USAGE_DIR: "/mine", AI_APP_ID: "DEV" }, "what is already set is kept");

const none: Record<string, string | undefined> = {};
adoptFleetUsageLog(none, no);
assert.deepEqual(none, {}, "a machine without the directory is left alone");

console.log("usage-dir: ok");
