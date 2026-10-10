/**
 * What Loki already did about a finding — the memory Watch lacked.
 *
 * Pins: the server's `known` list is read defensively; the row that answers
 * for a key is the OPEN one, else the newest (an old closed row never
 * silences a finding whose later fix is live); a remark whose fix is in
 * flight or closed is not said, one whose fix is live is said as "back",
 * an unknown one is said with Fix this; the card's chip reads as a person
 * expects; the ingest dedupes an owner's "Fix this" by key BEFORE the
 * content hash and stores the key only with a valid pass; the owner route
 * sends `known` for every keyed row, not just the twelve the strip shows.
 *
 * Run: npx tsx scripts/test/known-fixes.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NOTICE_KEY_MAX,
  knownFor,
  knownLabel,
  parseKnown,
  remarkVerdict,
  type KnownFix,
} from "../../widget/known-fixes";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const fix = (over: Partial<KnownFix>): KnownFix => ({
  key: "/p|checks|The page has no main heading (h#)",
  id: "f1",
  at: "2026-10-10T10:00:00Z",
  label: "Building",
  tone: "accent",
  detail: "An agent is working on it right now.",
  live: false,
  settled: false,
  href: "https://loki.example/feedback",
  ...over,
});

console.log("known-fixes:");

check("the server's list is read defensively and clamped", () => {
  const list = parseKnown({
    known: [
      fix({}),
      {
        key: "x".repeat(400),
        id: "f2",
        label: "Live",
        tone: "bogus",
        live: true,
        settled: true,
        href: "javascript:alert(1)",
      },
      { id: "no-key" },
      null,
      "junk",
    ],
  });
  assert.equal(list.length, 2);
  assert.equal(list[1]!.key.length, NOTICE_KEY_MAX);
  assert.equal(list[1]!.tone, "neutral");
  assert.equal(list[1]!.href, null, "a javascript: href never reaches a card");
  assert.deepEqual(parseKnown({}), []);
  assert.deepEqual(parseKnown(null), []);
});

check(
  "the open row answers for a key; else the newest; an old closed row cannot silence a live fix",
  () => {
    const key = fix({}).key;
    const closedOld = fix({
      id: "old",
      at: "2026-09-01T00:00:00Z",
      label: "Closed",
      settled: true,
      live: false,
    });
    const liveNewer = fix({
      id: "live",
      at: "2026-10-01T00:00:00Z",
      label: "Live",
      settled: true,
      live: true,
    });
    const open = fix({ id: "open", at: "2026-10-10T00:00:00Z" });
    assert.equal(knownFor([closedOld, liveNewer, open], key)!.id, "open");
    assert.equal(knownFor([closedOld, liveNewer], key)!.id, "live");
    assert.equal(
      knownFor([liveNewer, closedOld], key)!.id,
      "live",
      "order of arrival does not matter",
    );
    assert.equal(knownFor([open], "/q|checks|other"), null);
  },
);

check("in flight or closed → silent; live → again; unknown → say", () => {
  assert.equal(remarkVerdict(null), "say");
  assert.equal(remarkVerdict(fix({})), "silent", "building");
  assert.equal(
    remarkVerdict(fix({ label: "Needs you", tone: "warning" })),
    "silent",
    "needs you is still with Loki",
  );
  assert.equal(remarkVerdict(fix({ label: "In line", tone: "neutral" })), "silent");
  assert.equal(
    remarkVerdict(fix({ label: "Closed", settled: true, live: false })),
    "silent",
    "the owner decided",
  );
  assert.equal(remarkVerdict(fix({ label: "Live", settled: true, live: true })), "again");
});

check("the chip reads as a person expects", () => {
  assert.equal(knownLabel(fix({})), "Being fixed · Building");
  assert.equal(knownLabel(fix({ label: "In line", tone: "neutral" })), "Being fixed · In line");
  assert.equal(knownLabel(fix({ label: "Needs you", tone: "warning" })), "Needs you");
  assert.equal(knownLabel(fix({ label: "Live", settled: true, live: true })), "Fixed 10 Oct");
  assert.equal(knownLabel(fix({ label: "Closed", settled: true, live: false })), "Closed");
});

check("ingest: the key dedupes before the content hash, and only an owner's key is stored", () => {
  const ingest = readFileSync("src/app/api/feedback/route.ts", "utf8");
  assert.ok(ingest.includes("noticeKey: z.string().max(300)"), "the field is capped");
  assert.ok(
    ingest.indexOf("bumpDuplicateFeedbackByNotice(") <
      ingest.indexOf("bumpDuplicateFeedback(token.projectId, contentHash)"),
    "a keyed finding finds its row before the words are hashed",
  );
  assert.match(ingest, /const noticeKey = fromOwner && data\.noticeKey \? data\.noticeKey : null/);
  const widget = readFileSync("widget/send-report.ts", "utf8");
  assert.ok(
    widget.includes("noticeKey.slice(0, 300)"),
    "the widget clamps the key to the server's cap",
  );
});

check("the owner route answers for every keyed row, beyond the strip's twelve", () => {
  const route = readFileSync("src/app/api/widget/owner/changes/route.ts", "utf8");
  assert.ok(route.includes("KNOWN_FIXES_MAX"), "a whole site's findings, not twelve");
  assert.ok(route.includes("i.noticeKey"), "keyed rows, open or settled");
  assert.match(route, /known,\s*inbox,\s*visitors/);
  const watch = readFileSync("widget/watch.ts", "utf8");
  assert.ok(watch.includes("await lookFirst()"), "Watch looks before it speaks");
  assert.ok(watch.includes("noticeKey: key"), "a failure Watch files itself carries its key too");
  const conv = readFileSync("widget/conversation.ts", "utf8");
  assert.ok(conv.includes("{ noticeKey: key }"), "Fix this files the key with the note");
});

console.log(`\nknown-fixes: ${passed} passed`);
