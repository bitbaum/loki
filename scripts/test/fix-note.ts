// The design note a fix carries in its PR description (src/lib/feedback/fix-note.ts):
// the instruction the agent gets and the parser that reads it back must agree,
// and a PR without the section must read as "no note", never as a half note.
import assert from "node:assert/strict";

import {
  fixNoteInstruction,
  parseFixNote,
  FIX_NOTE_HEADING,
} from "../../src/lib/feedback/fix-note";
import { deriveShippingFromPr } from "../../src/lib/feedback/fix-shipping";

// ---- a well-formed note ----
{
  const body = [
    "Fixes the overlap.",
    "",
    "## Walkthrough",
    "- Problem: The caption card had no stacking order, so the site's tab bar drew over it.",
    "- Change: The caption now sits above everything and rises clear of a bottom tab bar.",
    "- Why: The tour is something the owner started on purpose; it should win.",
    "- Considered: Hide the site's tab bar during the tour — changes their page under them",
    "- Considered: Move the caption to the top — covers the headline the tour points at",
    "- Helps: Anyone watching a fix on a phone.",
    "- Where: The caption at the bottom of the screen during a walkthrough.",
    "- For the reporter: The walkthrough card no longer hides behind the menu bar.",
    "",
    "## Verification",
    "- Problem: not part of the note",
  ].join("\n");
  const note = parseFixNote(body);
  assert.ok(note);
  assert.match(note.problem ?? "", /no stacking order/);
  assert.match(note.change ?? "", /rises clear/);
  assert.equal(note.considered.length, 2);
  assert.equal(note.considered[0].option, "Hide the site's tab bar during the tour");
  assert.match(note.considered[0].whyNot ?? "", /changes their page/);
  assert.match(note.plain ?? "", /no longer hides/);
  assert.match(note.where ?? "", /bottom of the screen/);
}

// ---- tolerant of how agents actually write markdown ----
{
  const note = parseFixNote(
    [
      "### walkthrough",
      "**Problem**: wrapped over",
      "  two lines.",
      "* Change: bold labels and star bullets",
    ].join("\r\n"),
  );
  assert.equal(note?.problem, "wrapped over two lines.");
  assert.equal(note?.change, "bold labels and star bullets");
}

// ---- absent, empty or placeholder-only reads as no note ----
assert.equal(parseFixNote(null), null);
assert.equal(parseFixNote("Just a description."), null);
assert.equal(parseFixNote(`## ${FIX_NOTE_HEADING}\n- Problem: <what was actually wrong>`), null);

// ---- the instruction lists every label the parser reads ----
{
  const instruction = fixNoteInstruction();
  const filled = instruction
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/<[^>]*>/, "filled in"))
    .join("\n");
  const note = parseFixNote(`## ${FIX_NOTE_HEADING}\n${filled}`);
  assert.ok(note);
  for (const k of ["problem", "change", "why", "helps", "where", "plain"] as const)
    assert.equal(note[k], "filled in", `instruction and parser agree on ${k}`);
  assert.equal(note.considered[0]?.option, "filled in");
}

// ---- caps: at most three alternatives, fields bounded ----
{
  const many = Array.from({ length: 6 }, (_, i) => `- Considered: option ${i} — no`).join("\n");
  const note = parseFixNote(`## Walkthrough\n${many}\n- Why: ${"x".repeat(2000)}`);
  assert.equal(note?.considered.length, 3);
  assert.ok((note?.why ?? "").length <= 400);
}

// ---- the ledger keeps it ----
{
  const fix = deriveShippingFromPr(
    {
      number: 7,
      html_url: "https://github.com/o/r/pull/7",
      title: "fix",
      state: "open",
      merged_at: null,
      merge_commit_sha: null,
      body: "## Walkthrough\n- Change: kept on the ledger",
    },
    null,
    "2026-10-07T00:00:00Z",
  );
  assert.equal(fix.pr?.note?.change, "kept on the ledger");
}

console.log("fix-note: ok");
