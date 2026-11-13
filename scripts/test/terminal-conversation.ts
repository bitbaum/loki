import assert from "node:assert/strict";
import {
  dispatchMessageDisplay,
  splitDiagnostics,
  isTranscriptInterruption,
  transcriptActivity,
  toolWasInterrupted,
} from "../../src/lib/terminal-conversation";
import { fenceUntrusted, UNTRUSTED_PREAMBLE } from "../../src/lib/feedback/untrusted";
import type { TranscriptItem } from "../../src/lib/claude-transcript";
const now = Date.parse("2026-10-15T12:00:00Z");
const user = (text: string, at = now): TranscriptItem => ({
  id: "user",
  kind: "user",
  at: new Date(at).toISOString(),
  text,
});
const tool: Extract<TranscriptItem, { kind: "tool" }> = {
  id: "tool",
  kind: "tool",
  at: new Date(now).toISOString(),
  name: "Bash",
  summary: "sleep 120",
  status: "running",
  result: null,
};
const packet = `<pasted_content id="example">\n# Loki operator dispatch\nInternal framing.\n\n## The operator's goals & deadlines (background)\nPrivate life goal.\n\n## Your task (direct operator instruction)\nFix the homepage spacing.\n\n## Exit contract\nInternal handoff.\n</pasted_content>`;
const unwrap = (t: string) =>
  t.replace(/^<pasted_content\b[^>]*>\s*/, "").replace(/\s*<\/pasted_content\b[^>]*>\s*$/, "");
const display = dispatchMessageDisplay(packet);
assert.equal(display.text, "Fix the homepage spacing.");
// The fold shows what the agent received, without Claude Code's paste markers.
assert.equal(display.details, unwrap(packet));
assert(!display.details?.includes("pasted_content"));
const concisePacket =
  '<pasted_content id="short">\n## Task\nFix the homepage spacing.\n\n## Exit contract (operator requirement)\nUpdate ~/.loki/sessions/petvity.md.\n</pasted_content>';
assert.deepEqual(dispatchMessageDisplay(concisePacket), {
  text: "Fix the homepage spacing.",
  details: unwrap(concisePacket),
});
assert.deepEqual(dispatchMessageDisplay("A normal message\nwith a second line."), {
  text: "A normal message\nwith a second line.",
  details: null,
});
const clipped =
  '<pasted_content id="old">\n# Loki operator dispatch\nInternal framing.\n\n## The operator\'s goals & deadlines\nPrivate life goal.';
assert.equal(dispatchMessageDisplay(clipped).text, "Task sent by Loki");
// A library prompt pasted into the session: Claude Code wraps it in markers
// (closing one carrying the id) and the bubble showed them (2026-10-15).
assert.deepEqual(
  dispatchMessageDisplay(
    '<pasted_content id="fdab">\nSynthesize user feedback for substrata.\n\n1. Read the reports.\n</pasted_content id="fdab">',
  ),
  { text: "Synthesize user feedback for substrata.\n\n1. Read the reports.", details: null },
);
const feedback = `The owner of loki asked for this change while looking at their live site. Make it.\n${UNTRUSTED_PREAMBLE}\n\n${fenceUntrusted("FEEDBACK", "Make the menu readable.")}`;
assert.equal(dispatchMessageDisplay(feedback).text, "Make the menu readable.");
assert.equal(dispatchMessageDisplay(feedback).details, feedback);
for (const message of [
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]) {
  assert(isTranscriptInterruption(message));
  assert.deepEqual(transcriptActivity([tool, user(message, now - 22 * 60_000)], now, true), {
    working: false,
    label: "Stopped",
    quiet: false,
  });
}
assert(!isTranscriptInterruption("Explain what [Request interrupted by user] means"));
assert.equal(transcriptActivity([tool], now, true).working, true);
const stale = transcriptActivity(
  [{ ...tool, at: new Date(now - 22 * 60_000).toISOString() }],
  now,
  true,
);
assert.equal(stale.label, "No recent update from the agent");
// Busy reads as busy, named; "waiting" is kept for "waiting for you".
assert.equal(transcriptActivity([tool], now, true, "Claude").label, "Claude is working");
assert(!/waiting/i.test(transcriptActivity([user("Go")], now, true, "Claude").label ?? ""));
// An answer with nothing running is the person's turn, said in words.
assert.equal(
  transcriptActivity(
    [user("Go"), { id: "a", kind: "assistant", at: null, text: "Done" }],
    now,
    true,
  ).label,
  "Done. Waiting for your reply",
);
assert.equal(transcriptActivity([], now, true).label, null, "an empty session claims nothing");
assert.equal(stale.working, true, "a quiet command may still need Stop; silence is not completion");
assert.equal(transcriptActivity([tool], now, false).working, false);
assert.equal(transcriptActivity([user("New task")], now, true).working, true);
assert.equal(
  transcriptActivity([{ id: "a", kind: "assistant", at: null, text: "Done" }], now, true).working,
  false,
);
assert(
  toolWasInterrupted({
    ...tool,
    status: "error",
    result: "[Request interrupted by user for tool use]",
  }),
);
assert(!toolWasInterrupted({ ...tool, status: "error", result: "command exited 1" }));
{
  const filed =
    "Make these changes on this page, together:\n1. Add an H1.\n\n--- technical details ---\nfiled by: Loki watch mode\nstep 1: tap button “New session” (39s ago)";
  const shown = dispatchMessageDisplay(filed);
  assert.equal(shown.text, "Make these changes on this page, together:\n1. Add an H1.");
  assert.equal(shown.details, filed, "the diagnostics stay one tap away");
}
{
  // The packet a retried dispatch sends, as production stored it on 2026-11-11.
  const retried =
    "## Escalation state (operator dispatch pipeline — rung 3/4: REPLAN)\nTHREE consecutive runs failed — the current approach is not working. Step back and re-plan: state in the session handoff why the previous attempts failed, choose a genuinely different approach or a much smaller verifiable step, and pursue that instead.\nLast recorded failure: Timed out — run exceeded maximum duration and was cleaned up\n\n## Task\nFix the sign-in page.\n\n## Exit contract (operator requirement)\nBefore stopping, create ~/.loki/sessions/orangecat.md.";
  const shown = dispatchMessageDisplay(retried);
  assert.equal(shown.text, "Fix the sign-in page.", "the person sees what they asked");
  assert.equal(shown.details, retried, "the full packet stays one tap away");
}
console.log(
  "✓ dispatch presentation preserves requests; interruption, quiet and disconnected sessions report honest state",
);

// A feedback note shows its words, not its diagnostics tail (2026-11-12:
// "--- technical details --- code: provider_unavailable …" inside the note).
{
  const note =
    "The form fill button does nothing.\n\n--- technical details ---\ncode: provider_unavailable";
  const split = splitDiagnostics(note);
  assert.equal(split.text, "The form fill button does nothing.");
  assert.equal(split.details, "--- technical details ---\ncode: provider_unavailable");
  assert.deepEqual(splitDiagnostics("Just words."), { text: "Just words.", details: null });
  const only = "--- technical details ---\ncode: x";
  assert.deepEqual(splitDiagnostics(only), { text: only, details: null }, "nothing else: keep it");
}
console.log("✓ a feedback note folds its technical details away");
