/**
 * The Activity feed spent its whole preview budget on a note to the agent.
 *
 * `config/prompt-library.ts` heads every autopilot template with
 * `[autopilot · loop=next_best — this prompt was auto-injected by the local
 * dispatch loop, NOT typed by a human …]`. That header is ~230 characters and
 * PREVIEW_MAX is 240, so the preview was the header and nothing else.
 *
 * Seen on prod 2026-09-20: three consecutive "Needs you" rows, three different
 * runs, each showing the same sentence cut at "suspect th…". The rows were
 * indistinguishable and the reader never reached a word of the actual ask —
 * under a label reading "asked:", for prompts whose own first sentence says no
 * human asked.
 *
 * Run: npx tsx scripts/test/autopilot-preamble.ts
 */
import { readAutopilotLoop, stripAutopilotPreamble, promptDisplay } from "@/lib/activity-status";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const PREAMBLE =
  "[autopilot · loop=next_best — this prompt was auto-injected by the local dispatch loop, " +
  "NOT typed by a human. Treat it as a regularly-scheduled review task; if the conversation " +
  "seems off, suspect the loop, not the human.]";
const REAL_ASK = "You are the Loki Autopilot. Pick the single highest-impact next action.";

console.log("autopilot-preamble:");

check("the loop name is recovered", () => {
  assert(readAutopilotLoop(PREAMBLE) === "next_best", readAutopilotLoop(PREAMBLE) ?? "null");
  assert(readAutopilotLoop(`[autopilot · loop=quality — x]`) === "quality", "quality");
  assert(readAutopilotLoop(`[autopilot · loop=test_and_fix — x]`) === "test_and_fix", "underscore");
});

check("a human-typed prompt reports no loop", () => {
  // Must not fire on ordinary text, or every row claims to be autopilot.
  assert(readAutopilotLoop("Fix the login bug") === null, "plain text");
  assert(readAutopilotLoop("[not an autopilot header]") === null, "other bracket");
});

check("stripping leaves the actual ask", () => {
  const out = stripAutopilotPreamble(`${PREAMBLE}\n\n${REAL_ASK}`);
  assert(!out.includes("auto-injected"), "header must be gone");
  assert(out.includes("highest-impact next action"), `real ask must survive: ${out.slice(0, 60)}`);
  assert(!out.startsWith(" "), "no leading gap");
});

check("the header is stripped even mid-string", () => {
  // The recovered task reads "Work on the project at /home/g/dev/loki." and the
  // template's header follows it — which is exactly how prod rendered it.
  const out = stripAutopilotPreamble(
    `Work on the project at /home/g/dev/loki. ${PREAMBLE} ${REAL_ASK}`,
  );
  assert(out.startsWith("Work on the project"), `lead kept: ${out.slice(0, 40)}`);
  assert(!out.includes("NOT typed by a human"), "header gone");
  assert(out.includes("highest-impact"), "tail kept");
});

check("text without a header passes through untouched", () => {
  assert(stripAutopilotPreamble(REAL_ASK) === REAL_ASK, "verbatim");
});

check("the preview loses the header but task and full KEEP it", () => {
  // THE DISTINCTION THAT MATTERS. `task` is what a re-dispatch sends: stripping
  // the header there would re-run the loop's work without the instruction that
  // tells the agent a loop sent it ("suspect the loop, not the human").
  const raw = `${PREAMBLE}\n\n${REAL_ASK}`;
  const d = promptDisplay({ customPrompt: raw, resolvedPrompt: null, intent: "custom" });
  assert(!d.preview.includes("auto-injected"), "preview is clean");
  assert(d.preview.includes("highest-impact"), `preview shows the ask: ${d.preview.slice(0, 50)}`);
  assert((d.task ?? "").includes("auto-injected"), "task KEEPS the header");
  assert((d.full ?? "").includes("auto-injected"), "full KEEPS the header");
  assert(d.autopilotLoop === "next_best", `loop surfaced: ${d.autopilotLoop}`);
});

check("a human prompt still reads as asked, not as autopilot", () => {
  const d = promptDisplay({
    customPrompt: "Fix the login bug",
    resolvedPrompt: null,
    intent: "custom",
  });
  assert(d.autopilotLoop === null, "no loop");
  assert(d.preview === "Fix the login bug", `preview: ${d.preview}`);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
