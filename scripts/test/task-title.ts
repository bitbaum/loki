/**
 * Control names a run in plain words (src/lib/task-title.ts) and says what its
 * agent is doing now (src/lib/run-step.ts). Before, the page showed the first
 * 120 characters of the prompt sent to the agent — for a feedback fix, the
 * safety preamble (2026-10-17).
 *
 * Run: npx tsx scripts/test/task-title.ts
 */
import assert from "node:assert/strict";
import { intentTitle, taskTitle } from "@/lib/task-title";
import { latestRunStep } from "@/lib/run-step";
import { UNTRUSTED_PREAMBLE, fenceUntrusted } from "@/lib/feedback/untrusted";
import type { TranscriptItem } from "@/lib/claude-transcript";

let n = 0;
const eq = (a: unknown, b: unknown, label: string) => {
  assert.equal(a, b, label);
  n++;
};

eq(
  taskTitle(
    "Develop a new version of this existing website: https://center-com.ru/\nRequested changes (the customer's exact words): Cleaner home page",
  ),
  "Develop a new version of this existing website: center-com.ru",
  "a site brief reads as its first line, the link as its domain",
);
eq(
  taskTitle(
    [
      "The owner of loki asked for this change while looking at their live site. Make it.",
      UNTRUSTED_PREAMBLE,
      "",
      fenceUntrusted("FEEDBACK", "The header overlaps the logo on my phone"),
      "Page: https://loki.orangecat.ch/control",
    ].join("\n"),
  ),
  "The header overlaps the logo on my phone",
  "a feedback fix reads as the report, never as the preamble",
);
eq(
  taskTitle(
    "The owner of loki read this report and decided what to change. Do exactly what THE ASK says.\n" +
      `${UNTRUSTED_PREAMBLE}\n\nTHE ASK: make the save button bigger\n`,
  ),
  "Make the save button bigger",
  "an owner's decision reads as THE ASK",
);
eq(
  taskTitle(`Fix these 4 visitor-feedback items on heidi in one pass.\n${UNTRUSTED_PREAMBLE}`),
  "Fix 4 feedback reports",
  "a batch fix names how many",
);
eq(taskTitle(null, "next_best"), "Next best task", "no prompt: the library's name for the intent");
eq(taskTitle("", "test_and_fix"), intentTitle("test_and_fix"), "an intent without a prompt");
eq(intentTitle("some_new_intent"), "Some new intent", "an unknown intent is humanised");
eq(intentTitle(null), "A task", "nothing at all");
const long = taskTitle(`Add ${"a very long ".repeat(12)}feature`);
assert.ok(long.length <= 72 && long.endsWith("…"), "a long title is clipped on a word");
n++;
eq(
  taskTitle("## Goal\n\n- add a contact form. Then ship it."),
  "Add a contact form",
  "markdown and the second sentence go",
);

const at = null;
const tool = (name: string, summary: string): TranscriptItem => ({
  id: name + summary,
  at,
  kind: "tool",
  name,
  summary,
  status: "done",
  result: null,
});
eq(
  latestRunStep([tool("Edit", "/home/u/dev/site/src/Header.tsx")]),
  "Editing Header.tsx",
  "a file edit names the file",
);
eq(latestRunStep([tool("Bash", "npm test")]), "Running npm test", "a command names itself");
eq(
  latestRunStep([
    tool("Read", "/a/b.ts"),
    {
      id: "a",
      at,
      kind: "assistant",
      text: "Now I'll add the contact form. It goes under the hero.",
    },
  ]),
  "Now I'll add the contact form.",
  "the agent's own words win when they are newest",
);
eq(
  latestRunStep([{ id: "u", at, kind: "user", text: "fix it" }]),
  "Reading the request",
  "just sent",
);
eq(latestRunStep([]), null, "nothing yet");

console.log(`✓ task-title: ${n} checks passed`);
