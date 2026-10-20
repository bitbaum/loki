/**
 * A stranger's words reach a builder only by a person's tap.
 *
 * Four holes, found by tracing a visitor's note end to end (2026-10-19):
 * a visitor could label their note as Loki's own finding; an overnight
 * allowance built strangers' notes with nobody looking; opening a stranger's
 * tracking link started their build; and every customer's feedback went to
 * the operator's Telegram. Each is pinned here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAgentPass, verifyAgentPass } from "../../src/lib/feedback/agent-pass";
import { composeReviewPrompt } from "../../src/lib/feedback/ai-review-prompt";
import { FEEDBACK_SOURCE, waitsForATap } from "../../src/lib/constants/statuses";

process.env.AUTH_SECRET ??= "test-secret-for-agent-pass";
process.env.NEXT_PUBLIC_APP_URL ??= "https://loki.example";

const read = (p: string) => readFileSync(p, "utf8");
const project = "8d96d258-36f2-4b47-a897-9a5baeb6c296";
const other = "9e96d258-36f2-4b47-a897-9a5baeb6c296";
const now = Date.parse("2026-10-19T08:00:00Z");

// ─── 1. Who filed a note is the server's call ────────────────────────────────
const pass = createAgentPass(project, FEEDBACK_SOURCE.AI_REVIEW, now);
assert.equal(verifyAgentPass(pass, project, now), FEEDBACK_SOURCE.AI_REVIEW);
assert.equal(verifyAgentPass(pass, other, now), null, "a pass proves one project");
assert.equal(verifyAgentPass(pass, project, now + 49 * 3600_000), null, "it expires");
assert.equal(verifyAgentPass(undefined, project, now), null);
assert.equal(verifyAgentPass("", project, now), null);
const [p, , exp, sig] = pass.split(".");
assert.equal(
  verifyAgentPass(`${p}.synthesizer.${exp}.${sig}`, project, now),
  null,
  "a reviewer's pass cannot be relabelled as the synthesizer's",
);
assert.equal(
  verifyAgentPass(`${p}.owner.${exp}.${sig}`, project, now),
  null,
  "never the owner — that is the owner pass's job",
);

const ingest = read("src/app/api/feedback/route.ts");
assert.match(
  ingest,
  /verifyAgentPass\(data\.agentPass, token\.projectId\) \?\? FEEDBACK_SOURCE\.VISITOR/,
  "the source comes from a verified pass, else visitor",
);
assert.doesNotMatch(ingest, /data\.source/, "the claimed source is never read");

const prompt = composeReviewPrompt("https://site.example/", { id: project, name: "Site" }, "fcw_x");
const promptPass = /"agentPass":"([^"]+)"/.exec(prompt)?.[1];
assert.ok(promptPass, "the reviewer's prompt carries its pass");
assert.equal(verifyAgentPass(promptPass, project), FEEDBACK_SOURCE.AI_REVIEW);
assert.doesNotMatch(prompt, /"source":/, "and no longer asserts a source");
const synth = read("src/app/api/projects/[id]/feedback/synthesize/route.ts");
assert.match(synth, /createAgentPass\(project\.id, FEEDBACK_SOURCE\.SYNTHESIZER\)/);
assert.doesNotMatch(synth, /"source":"/);

// ─── 2. An allowance never builds a stranger's note ──────────────────────────
assert.equal(waitsForATap(FEEDBACK_SOURCE.VISITOR), true);
assert.equal(waitsForATap(null), true, "a row older than sources is nobody's word");
assert.equal(waitsForATap(FEEDBACK_SOURCE.OWNER), false);
assert.equal(waitsForATap(FEEDBACK_SOURCE.AI_REVIEW), false);
assert.equal(waitsForATap(FEEDBACK_SOURCE.CLIENT), true, "a client's ask waits for the owner");
assert.equal(waitsForATap(FEEDBACK_SOURCE.MEMBER), true, "so does any other seat's");
const night = read("src/lib/autopilot-night.ts");
assert.match(
  night,
  /if \(planned\.verdict\.auto && planned\.f\.open\.some\(\(r\) => waitsForATap\(r\.source\)\)\) \{\s*planned = await planFor\(false\);/,
  "a plan nobody will tap is re-made without strangers' notes",
);
assert.match(night, /\(strangers \|\| !waitsForATap\(f\.source\)\)/);

// ─── 3. Opening a tracking link starts nothing ───────────────────────────────
const claim = read("src/app/api/feedback/claim/route.ts");
assert.doesNotMatch(claim, /implementFeedback/, "a link never builds");
assert.ok(
  claim.indexOf("access?.canEdit") < claim.indexOf("claimFeedbackForReporter("),
  "someone who builds the project does not take the reporter's claim",
);

// ─── 4. Each account's news reaches its own channels ────────────────────────
for (const f of [
  "src/lib/feedback/notify-new.ts",
  "src/lib/feedback/notify-shipped.ts",
  "src/lib/feedback/notify-needs-you.ts",
  "src/lib/orchestration/notify-close.ts",
  "src/lib/autopilot-night.ts",
]) {
  const src = read(f);
  assert.doesNotMatch(
    src,
    /selfTelegramTarget\(/,
    `${f}: per-account news never goes to the box-wide chat`,
  );
  assert.match(src, /telegramTargetFor\(/, `${f}: Telegram only for the operator's own work`);
}

console.log("✓ feedback trust: source, night, claim link, Telegram");
