// A finished run's summary, as the Loki chat shows it under the dispatch that
// started it: what changed, what was checked, and next steps that carry on in
// the same chat. Pinned: empty fields say nothing; lists split and cap; long
// agent text is clipped; and both live-status routes carry it to the card.
// Run: npx tsx scripts/test/run-handoff.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextStepPrompt, runFollow, runHandoff } from "@/lib/run-handoff";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";

assert.equal(runHandoff(null), null, "no summary, no handoff");
assert.equal(
  runHandoff({ done: "none", next: "N/A", tests: "not run" }),
  null,
  "a summary of empty words is no handoff — the card reads as before",
);

const h = runHandoff({
  done: "Added ?run= to Watch; widget links building rows to the run; fixed the test",
  next: "- Show the run inline in chat\n- Add a phone check\n- Tidy copy\n- A fourth",
  tests: "unit 386/386 pass; tsc clean",
});
assert.ok(h);
assert.deepEqual(h.done, [
  "Added ?run= to Watch",
  "widget links building rows to the run",
  "fixed the test",
]);
assert.deepEqual(
  h.next,
  ["Show the run inline in chat", "Add a phone check", "Tidy copy"],
  "bullet lines split, capped at three",
);
assert.equal(h.checked, "unit 386/386 pass; tsc clean");

const long = runHandoff({ done: "x".repeat(500), next: "", tests: "" });
assert.ok(long && long.done[0].length <= 240 && long.done[0].endsWith("…"), "long text clipped");
assert.deepEqual(long.next, []);
assert.equal(long.checked, null);

assert.deepEqual(runHandoff({ done: "Same; same; Same" })?.done, ["Same"], "no repeats");
assert.equal(nextStepPrompt("Add a phone check"), "Next: Add a phone check");

for (const route of [
  "src/app/api/control/commands/[id]/route.ts",
  "src/app/api/orchestration/runs/[id]/route.ts",
]) {
  assert.match(readFileSync(route, "utf8"), /handoff: runHandoff\(run/, `${route} carries it`);
}

// ---- after the run: PR → merged → live → Loki's look ----
const at = "2026-10-11T00:00:00.000Z";
const pr = { number: 7, url: "https://github.com/o/r/pull/7", title: "t" };
const ship = (over: Partial<FixShipping>): FixShipping => ({
  state: FIX_SHIP_STATE.PR_OPEN,
  checkedAt: at,
  pr,
  ...over,
});
assert.equal(runFollow(null, "https://site.test"), null, "nothing found, nothing to follow");
assert.equal(
  runFollow(ship({ state: FIX_SHIP_STATE.NO_EVIDENCE }), "https://site.test"),
  null,
  "no PR, push or commit: the card says nothing rather than guess",
);
const open = runFollow(ship({}), "https://site.test");
assert.ok(open && !open.settled && open.prUrl === pr.url && open.liveUrl === null);
assert.match(open.label, /waiting to merge/);
const merged = runFollow(ship({ state: FIX_SHIP_STATE.MERGED }), "https://site.test");
assert.ok(merged && !merged.settled && merged.liveUrl === null, "merged is not live");
const deployed = runFollow(ship({ state: FIX_SHIP_STATE.DEPLOYED }), "https://site.test");
assert.ok(deployed && deployed.label === "Live" && deployed.liveUrl === "https://site.test");
assert.equal(deployed.settled, false, "live but not looked at yet: keep asking");
const noSite = runFollow(ship({ state: FIX_SHIP_STATE.DEPLOYED }), null);
assert.ok(noSite && noSite.settled, "live with no page to read: nothing left to wait for");
const looked = runFollow(
  ship({
    state: FIX_SHIP_STATE.DEPLOYED,
    verify: {
      verdict: "not_visible",
      evidence: "The heading still says To review.",
      at,
      url: "https://site.test/page",
    },
  }),
  "https://site.test",
);
assert.ok(looked && looked.settled && looked.looked?.verdict === "not_visible");
assert.equal(looked.liveUrl, "https://site.test/page", "the page Loki read is the one offered");
assert.ok(runFollow(ship({ state: FIX_SHIP_STATE.PR_CLOSED }), "https://x.test")?.settled);

// Only a person's open card asks — never a timer (no-free-background-ai.ts).
const follow = readFileSync("src/lib/run-follow.ts", "utf8");
assert.match(follow, /autoShip: null/, "following never merges — the repo's own path decides");
assert.match(follow, /checkAiBudget\(userId\)/, "the look spends the owner's budget, checked");
assert.match(
  follow,
  /> FOLLOW_WINDOW_MS\) return runFollow\(fix, liveUrl\)/,
  "an old thread's cards read their ledger — no GitHub call, no look",
);

console.log("run-handoff: ok");
