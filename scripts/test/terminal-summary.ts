// The terminal's AI summary: read the screen as a person sees it, ask for a
// summary with next steps, and turn the "→" steps into one-tap injects.
// Operator ask, 2026-10-03: "make this screen an easy way to interact with the
// terminal. AI would give actionable summaries."
// Run: npx tsx scripts/test/terminal-summary.ts
import { readFileSync } from "fs";
import { join } from "path";
import { logicalLines, screenText, type ScreenBuffer } from "@/lib/terminal-screen";
import {
  SUMMARY_MAX_CHARS,
  screenAttachment,
  splitActions,
  summaryPrompt,
} from "@/lib/terminal-summary";
import { MAX_ATTACHMENT_CHARS } from "@/lib/loki/attachments";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}
const buffer = (rows: string[]): ScreenBuffer => ({
  length: rows.length,
  getLine: (i) => (rows[i] === undefined ? undefined : { translateToString: () => rows[i]! }),
});

// --- reading the screen -------------------------------------------------------
{
  const cols = 10;
  const rows = ["$ npm t", "https://ex", "ample.com/", "x", "done"];
  eq(
    logicalLines(buffer(rows), cols, 10),
    ["$ npm t", "https://example.com/x", "done"],
    "full-width rows join into one logical line",
  );
  eq(
    logicalLines(buffer(rows), cols, 2),
    ["https://example.com/x", "done"],
    "a window starting mid-line backs up to the line's start",
  );
  eq(logicalLines(buffer([]), cols, 10), [], "an empty screen has no lines");
}
{
  eq(
    screenText(["a", "", "", "", "b", "", ""], 100),
    "a\n\nb",
    "blank runs collapse, tail trimmed",
  );
  eq(screenText(["old line", "new line"], 8), "new line", "cut from the top: newest output wins");
}

// --- the request ---------------------------------------------------------------
{
  const prompt = summaryPrompt("derhochhin");
  eq(
    prompt.includes("derhochhin") && prompt.includes('"→ "'),
    true,
    "names the project and the → contract",
  );
  eq(prompt.length < 4000, true, "fits the messages route's text limit");
  eq(SUMMARY_MAX_CHARS < MAX_ATTACHMENT_CHARS, true, "the screen fits one attachment");
  const att = screenAttachment("$ ls", {
    label: "Working",
    stepSummary: "Tests",
    nextAction: "Wait.",
  });
  eq(
    att.kind === "text" && att.content.startsWith("Run status: Working — Tests. Wait."),
    true,
    "run status leads the screen",
  );
  eq(screenAttachment("$ ls", null).content, "$ ls", "no run → just the screen");
}

// --- reading the answer back ---------------------------------------------------
{
  const { body, actions } = splitActions(
    [
      "- Built the scaffold",
      "- Waiting for PR review",
      "",
      "→ Merge PR #1",
      "  → Register the site",
      "→ ",
    ].join("\n"),
  );
  eq(body, "- Built the scaffold\n- Waiting for PR review", "the body keeps the bullets");
  eq(actions, ["Merge PR #1", "Register the site"], "→ lines become actions; empty ones dropped");
  eq(splitActions("Nothing useful on screen.").actions, [], "no actions when none are offered");
}

// --- wiring ----------------------------------------------------------------------
{
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const rail = read("src/components/terminal/TerminalLokiRail.tsx");
  eq(
    /from "@bitbaum\/chatkit\/react"/.test(rail) && rail.includes("<ChatThread"),
    true,
    "the rail's conversation is chatkit's thread",
  );
  eq(rail.includes("MarkdownText"), false, "no hand-rolled answer renderer left in the rail");
  eq(
    read("src/components/terminal/TerminalSurface.tsx").match(/readScreenRef=\{readScreenRef\}/g)
      ?.length,
    2,
    "the screen reader reaches both the view and the rail",
  );
  eq(
    read("src/components/terminal/TerminalView.tsx").includes(
      "logicalLines(term.buffer.active, term.cols, 300)",
    ),
    true,
    "the link bar reads lines the same way",
  );
}

console.log(`${fail ? "✗" : "✓"} terminal-summary: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
