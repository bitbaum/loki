/**
 * A chat build is followed to live on a timer, and the person who sent it is
 * told once (lib/run-follow-notify).
 *
 * Run: npx tsx scripts/test/run-follow-notify.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIX_SHIP_STATE,
  isFailedCheckConclusion,
  prBlockerFor,
  prBlockerNews,
  type FixShipping,
} from "@/lib/feedback/fix-shipping";
import {
  ANNOUNCE_FRESH_MS,
  chatRunAnnouncement,
  chatRunBlockedMessage,
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

// ── A pull request that cannot merge as it stands ───────────────────────
// The fleet's sweep leaves a red or conflicted pull request waiting. The
// person who asked for the work is told once per commit, with the message
// that repairs it.
const HEAD = "b".repeat(40);
assert.equal(prBlockerFor({ mergeable: true, failedChecks: [], headSha: HEAD }), null);
assert.equal(
  prBlockerFor({ mergeable: null, failedChecks: [], headSha: HEAD }),
  null,
  "GitHub still computing is not a conflict",
);
assert.deepEqual(prBlockerFor({ mergeable: false, failedChecks: ["check"], headSha: HEAD }), {
  why: "conflict",
  checks: [],
  headSha: HEAD,
});
assert.deepEqual(
  prBlockerFor({ mergeable: true, failedChecks: ["check", "e2e", "check"], headSha: HEAD }),
  { why: "checks_failed", checks: ["check", "e2e"], headSha: HEAD },
);
assert.equal(isFailedCheckConclusion("failure"), true);
assert.equal(isFailedCheckConclusion("timed_out"), true);
assert.equal(isFailedCheckConclusion("cancelled"), false, "a superseded run is not a failure");
assert.equal(isFailedCheckConclusion("skipped"), false);
assert.equal(isFailedCheckConclusion(null), false, "still running");

const red = { why: "checks_failed" as const, checks: ["check", "e2e"], headSha: HEAD };
const openRed = ledger(FIX_SHIP_STATE.PR_OPEN, null, { blocked: red });
assert.deepEqual(prBlockerNews(open, openRed), red, "first sight of a red pull request");
assert.equal(prBlockerNews(openRed, openRed), null, "the same failure is not said twice");
assert.deepEqual(
  prBlockerNews(
    openRed,
    ledger(FIX_SHIP_STATE.PR_OPEN, null, { blocked: { ...red, headSha: "c".repeat(40) } }),
  ),
  { ...red, headSha: "c".repeat(40) },
  "a repair that failed too is a new commit, and is said",
);
assert.equal(prBlockerNews(openRed, open), null, "no longer blocked is not news here");
assert.equal(
  prBlockerNews(open, ledger(FIX_SHIP_STATE.MERGED, null, { blocked: red })),
  null,
  "only an open pull request can be blocked",
);

const blockedSaid = chatRunBlockedMessage({
  projectKey: "orangecat",
  blocked: red,
  prUrl: "https://github.com/bitbaum/orangecat/pull/1664",
});
assert.match(blockedSaid.content, /\*\*orangecat\*\* — the pull request cannot merge yet\./);
assert.match(blockedSaid.content, /2 checks failed: check, e2e\./);
assert.match(
  blockedSaid.content,
  /The pull request: https:\/\/github\.com\/bitbaum\/orangecat\/pull\/1664/,
);
// The way forward is a message that names the project, so sending it is a task.
assert.match(
  blockedSaid.content,
  /> orangecat: fix the failing checks on https:\/\/github\.com\/bitbaum\/orangecat\/pull\/1664 and push to the same branch\./,
);
assert.equal(blockedSaid.title, "orangecat · the pull request needs a repair");
const many = chatRunBlockedMessage({
  projectKey: "loki",
  blocked: { why: "checks_failed", checks: ["a", "b", "c", "d", "e"], headSha: HEAD },
  prUrl: "u",
});
assert.match(many.content, /5 checks failed: a, b, c and 2 more\./);
const one = chatRunBlockedMessage({
  projectKey: "loki",
  blocked: { why: "checks_failed", checks: ["check"], headSha: HEAD },
  prUrl: "u",
});
assert.match(one.content, /A check failed: check\./);
const conflict = chatRunBlockedMessage({
  projectKey: "loki",
  blocked: { why: "conflict", checks: [], headSha: HEAD },
  prUrl: "u",
});
assert.match(conflict.content, /It conflicts with the main branch\./);
assert.match(conflict.content, /> loki: bring the branch of u up to date with main/);

// The wiring: the existing fifteen-minute cron, the conversation's own
// thread, never a feedback fix (its row announces it), and no model.
const src = readFileSync("src/lib/run-follow-notify.ts", "utf8");
assert.match(src, /payload\}->>'conversationId' IS NOT NULL/);
assert.match(src, /getFeedbackByRunId\(run\.userId, run\.id\)/);
assert.match(src, /liveUrl,\n/);
assert.doesNotMatch(src, /lookAndRecord|checkAiBudget|callText/, "the timer spends no model call");
assert.match(src, /readBlockers: true/, "the follower asks whether the pull request can merge");
assert.match(src, /prBlockerNews\(before, fix\)/);
assert.doesNotMatch(
  src,
  /executeInject|injectPrompt|enqueuePendingCommand/,
  "the timer starts no agent run: nobody asked for one (lib/auto-dispatch)",
);
assert.match(
  readFileSync("src/lib/feedback/fix-shipping-refresh.ts", "utf8"),
  /if \(input\.readBlockers && fix\.state === FIX_SHIP_STATE\.PR_OPEN && pr\.headSha\)/,
  "the two extra GitHub reads happen only for a caller that asks",
);
assert.match(
  readFileSync("src/app/api/crons/check-feedback-needs-you/route.ts", "utf8"),
  /await followChatRuns\(\)/,
);

console.log(
  "✓ run-follow-notify: a chat build that goes live, or whose pull request cannot merge, is said once, in its thread and by push",
);
