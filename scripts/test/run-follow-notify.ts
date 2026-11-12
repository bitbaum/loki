/**
 * A chat build is followed to live on a timer, and the person who sent it is
 * told once (lib/run-follow-notify).
 *
 * Run: npx tsx scripts/test/run-follow-notify.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import {
  ANNOUNCE_FRESH_MS,
  chatRunAnnouncement,
  chatRunShippedMessage,
} from "@/lib/run-shipped-message";

const NOW = Date.parse("2026-11-12T07:00:00Z");
const ledger = (state: FixShipping["state"], at: string | null, extra: Partial<FixShipping> = {}) =>
  ({
    state,
    pr: {
      number: 1663,
      url: "https://github.com/bitbaum/loki/pull/1663",
      title: "x",
      mergedAt: "2026-11-12T06:40:00Z",
      mergeSha: "a".repeat(40),
    },
    ...(at
      ? {
          deploy: {
            url: "https://loki.orangecat.ch/r",
            name: "Deploy",
            conclusion: "success",
            status: "completed",
            at,
          },
        }
      : {}),
    checkedAt: "2026-11-12T06:59:00Z",
    ...extra,
  }) as FixShipping;

// Only the change to live or to a failed deploy is news.
const open = ledger(FIX_SHIP_STATE.PR_OPEN, null);
const live = ledger(FIX_SHIP_STATE.DEPLOYED, "2026-11-12T06:50:00Z");
assert.equal(chatRunAnnouncement(open, live, NOW), "live");
assert.equal(chatRunAnnouncement(null, live, NOW), "live", "first read, and it is fresh");
assert.equal(chatRunAnnouncement(live, live, NOW), null, "already said");
assert.equal(
  chatRunAnnouncement(open, ledger(FIX_SHIP_STATE.MERGED, null), NOW),
  null,
  "merged is not live",
);
assert.equal(
  chatRunAnnouncement(open, ledger(FIX_SHIP_STATE.DEPLOY_FAILED, "2026-11-12T06:55:00Z"), NOW),
  "deploy_failed",
);

// Old news is stamped, not announced: the first tick does not report history.
const longAgo = new Date(NOW - ANNOUNCE_FRESH_MS - 60_000).toISOString();
assert.equal(chatRunAnnouncement(null, ledger(FIX_SHIP_STATE.DEPLOYED, longAgo), NOW), null);
assert.equal(
  chatRunAnnouncement(
    null,
    { ...ledger(FIX_SHIP_STATE.DEPLOYED, null), pr: { number: 1, url: "u", title: "t" } },
    NOW,
  ),
  null,
  "a live moment that cannot be dated is not announced",
);
// With no deploy time, the merge time dates it.
assert.equal(chatRunAnnouncement(open, ledger(FIX_SHIP_STATE.DEPLOYED, null), NOW), "live");

// The words: the address first, then what changed. No promise of anything
// that does not exist for a chat build (no walkthrough, no "watch the fix").
const said = chatRunShippedMessage({
  announcement: "live",
  projectKey: "loki",
  fix: live,
  liveUrl: "https://loki.orangecat.ch",
});
assert.match(said.content, /\*\*loki\*\* — it is live\./);
assert.match(said.content, /The site: https:\/\/loki\.orangecat\.ch/);
assert.match(said.content, /What changed: https:\/\/github\.com\/bitbaum\/loki\/pull\/1663/);
assert.doesNotMatch(said.content, /walkthrough|Watch the fix/i);
assert.equal(said.title, "loki · your change is live");

const failed = chatRunShippedMessage({
  announcement: "deploy_failed",
  projectKey: "loki",
  fix: ledger(FIX_SHIP_STATE.DEPLOY_FAILED, "2026-11-12T06:55:00Z"),
  liveUrl: "https://loki.orangecat.ch",
});
assert.match(failed.content, /merged, but the deploy failed/);
assert.match(failed.content, /still shows the old version/);
assert.match(failed.content, /The failed deploy: https:\/\/loki\.orangecat\.ch\/r/);

// The wiring: the existing fifteen-minute cron, the conversation's own
// thread, never a feedback fix (its row announces it), and no model.
const src = readFileSync("src/lib/run-follow-notify.ts", "utf8");
assert.match(src, /payload\}->>'conversationId' IS NOT NULL/);
assert.match(src, /getFeedbackByRunId\(run\.userId, run\.id\)/);
assert.match(src, /liveUrl,\n/);
assert.doesNotMatch(src, /lookAndRecord|checkAiBudget|callText/, "the timer spends no model call");
assert.match(
  readFileSync("src/app/api/crons/check-feedback-needs-you/route.ts", "utf8"),
  /await followChatRuns\(\)/,
);

console.log(
  "✓ run-follow-notify: a chat build that goes live is said once, in its thread and by push",
);
