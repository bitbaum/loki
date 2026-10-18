/**
 * A session's last screen paints at once for the next viewer, marked as not
 * yet live, instead of a black pane until the runner answers peek_start
 * (owner, 2026-10-18: "the first thing I see is this screen, and only then,
 * a little bit later, the terminal appears").
 *
 * Run: npx tsx scripts/test/peek-screen-cache.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emitPeekFrame, forgetScreen, lastScreen } from "@/lib/sse-bus";

const user = "u-screen";
const at = Date.now();

// A delta with no screen under it is never replayed on its own.
emitPeekFrame(user, "solo", { seq: 0, frame: "[no live agent]", at, append: true }, "cloud");
assert.equal(lastScreen(user, "solo", "cloud"), null, "a delta alone is not a screen");

// A snapshot, then deltas: replayed as one screen, under both keys.
emitPeekFrame(user, "Center", { seq: 1, frame: "screen", at }, "cloud");
emitPeekFrame(user, "Center", { seq: 2, frame: "+more", at, append: true }, "cloud");
assert.equal(lastScreen(user, "Center", "cloud")?.frame, "screen+more", "snapshot plus deltas");
assert.equal(lastScreen(user, "center")?.frame, "screen+more", "the any-channel key, any case");
assert.equal(lastScreen(user, "Center", "local"), null, "never another builder's screen");

// A new snapshot replaces what came before.
emitPeekFrame(user, "Center", { seq: 3, frame: "fresh", at }, "cloud");
assert.equal(lastScreen(user, "Center", "cloud")?.frame, "fresh", "a snapshot starts over");

// Bounded, keeping the newest bytes; and forgotten once old.
emitPeekFrame(user, "Big", { seq: 0, frame: "a".repeat(250_000), at }, "cloud");
emitPeekFrame(user, "Big", { seq: 1, frame: "b".repeat(10_000), at, append: true }, "cloud");
const big = lastScreen(user, "Big", "cloud")!.frame;
assert.equal(big.length, 256_000, "capped like the runner's own replay");
assert.ok(big.endsWith("b".repeat(10_000)), "the newest bytes are the ones kept");
assert.equal(
  lastScreen(user, "Center", "cloud", at + 7 * 60 * 60 * 1000),
  null,
  "a screen hours old is not shown as the session",
);

// Closing a session forgets its screen on every builder.
forgetScreen(user, "CENTER");
assert.equal(lastScreen(user, "Center", "cloud"), null, "closed: not shown again");
assert.equal(lastScreen(user, "Center"), null, "under any key");
assert.ok(lastScreen(user, "Big", "cloud"), "other sessions keep theirs");
assert.match(
  readFileSync("src/app/api/control/close-tab/route.ts", "utf8"),
  /forgetScreen\(userId, dataOrResp\.tab\)/,
  "the close route forgets it",
);

// The stream sends it marked, and the transport tells the view it is not live.
const route = readFileSync("src/app/api/control/peek-stream/route.ts", "utf8");
assert.match(route, /lastScreen\(userId, tab, runnerChannel\)/, "the stream reads it");
assert.match(route, /append: false, cached: true/, "as a snapshot marked cached");
const transport = readFileSync("src/components/terminal/terminal-transport.ts", "utf8");
assert.match(transport, /h\.onCached\?\.\(cached === true\)/, "the transport passes the mark on");

console.log("✓ peek-screen-cache: the last screen paints at once, marked until the live one lands");
