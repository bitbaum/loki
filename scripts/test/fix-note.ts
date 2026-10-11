// The design note a fix carries in its PR description (src/lib/feedback/fix-note.ts):
// the instruction the agent gets and the parser that reads it back must agree,
// and a PR without the section must read as "no note", never as a half note.
import assert from "node:assert/strict";

import {
  fixNoteInstruction,
  parseFixNote,
  tidyFixNote,
  FIX_NOTE_HEADING,
  NOTE_NONE,
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
  for (const k of ["problem", "change", "why", "helps", "next", "where", "plain"] as const)
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

// ---- what agents actually wrote (substrata#169, 2026-10-09) ----
// Three alternatives on ONE Considered line, and the PR footer after a blank
// line. The first parser merged the alternatives into one and read the footer
// into the reporter's sentence — which a stranger would have seen.
{
  const body = [
    "## Walkthrough",
    "- Considered: Making everything 48px on desktop too — wastes space where a mouse pointer is precise. Invisible enlarged tap areas around the small numbers — measuring tools would still see a 16px box. Making links inside sentences 48px tall — it breaks the line of text.",
    "- For the reporter: Thanks — every button you pointed at is now big enough to tap.",
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ].join("\n");
  const note = parseFixNote(body);
  assert.equal(note?.considered.length, 3, "one alternative per dashed sentence");
  assert.equal(note?.considered[1].option, "Invisible enlarged tap areas around the small numbers");
  assert.equal(note?.considered[2].whyNot, "it breaks the line of text.");
  assert.equal(note?.plain, "Thanks — every button you pointed at is now big enough to tap.");

  // A reason that runs to a second sentence without a dash stays one alternative.
  const two = parseFixNote(
    "## Walkthrough\n- Considered: A modal — it blocks the page. People closed it unread.",
  );
  assert.equal(two?.considered.length, 1);
  assert.equal(two?.considered[0].whyNot, "it blocks the page. People closed it unread.");

  // Labelled lines after a blank line still count.
  const spaced = parseFixNote("## Walkthrough\n- Problem: a\n\n- Change: b");
  assert.equal(spaced?.change, "b");
}

// ---- notes saved by the first parser are repaired on the way out ----
{
  const stored = {
    problem: "p",
    change: "c",
    why: null,
    considered: [
      {
        option: "Making everything 48px on desktop too",
        whyNot:
          "wastes space. Invisible tap areas — tools would still see 16px. Inline links 48px — breaks the text.",
      },
    ],
    helps: null,
    where: null,
    plain:
      "Thanks — it is bigger now. 🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  };
  const tidy = tidyFixNote(stored);
  assert.equal(tidy.plain, "Thanks — it is bigger now.");
  assert.equal(tidy.considered.length, 3);
  assert.equal(tidy.considered[0].whyNot, "wastes space.");
  assert.deepEqual(tidyFixNote(tidy), tidy, "idempotent");
}

// ---- "Next": what else could be done, or honestly nothing ----
{
  const note = parseFixNote(
    "## Walkthrough\n- Change: c\n- Next: Lazy-load the gallery — left out to keep this change small.",
  );
  assert.match(note?.next ?? "", /Lazy-load/);
  assert.equal(parseFixNote("## Walkthrough\n- Change: c\n- Next: nothing")?.next, null);
  // Notes saved before the field existed still read.
  const { next: _drop, ...old } = note!;
  void _drop;
  assert.equal(tidyFixNote(old).next, null);
}

// ---- behind the scenes: what changed, and the proof (owner, 2026-10-11) ----
// "Something that you cannot screenshot and show … it still should explain
// exactly what was done. And how this change benefits users."
{
  const note = parseFixNote(
    [
      "## Walkthrough",
      "- Change: The nightly import retries a failed batch.",
      "- Shows: behind the scenes",
      "- Under the hood: When the supplier's server times out, the import now waits a minute and tries that batch again, up to three times, instead of skipping it.",
      "- Helps: Shop prices no longer go stale for a day when the supplier hiccups.",
      "- Proof: A test forces two timeouts and checks every row lands; last night's log shows 0 skipped batches.",
    ].join("\n"),
  );
  assert.equal(note?.shows, "behind");
  assert.match(note?.detail ?? "", /tries that batch again/);
  assert.match(note?.proof ?? "", /0 skipped batches/);
  assert.match(note?.helps ?? "", /no longer go stale/);
  assert.equal(parseFixNote("## Walkthrough\n- Change: c\n- Shows: on the page")?.shows, "page");
  assert.equal(
    parseFixNote("## Walkthrough\n- Change: c\n- Shows: no, backend only")?.shows,
    "behind",
  );
  // Older notes have none of it and still read.
  const { shows: _s, detail: _d, proof: _p, ...old } = note!;
  void _s;
  void _d;
  void _p;
  const tidy = tidyFixNote(old);
  assert.equal(tidy.shows, null);
  assert.equal(tidy.detail, null);
}

// ---- downsides, costs, benefit to us: "none" is a finding, said as "None" ----
{
  const note = parseFixNote(
    [
      "## Walkthrough",
      "- Change: c",
      "- Benefits us: Fewer support emails.",
      "- Downsides: none",
      "- Costs: No extra cost.",
    ].join("\n"),
  );
  assert.equal(note?.us, "Fewer support emails.");
  assert.equal(note?.downsides, NOTE_NONE);
  assert.equal(note?.costs, NOTE_NONE);
  const real = parseFixNote(
    "## Walkthrough\n- Change: c\n- Downsides: No caching, so the page is 40ms slower.\n- Costs: about $2/month more in AI calls",
  );
  assert.match(real?.downsides ?? "", /40ms slower/, "a real downside starting with 'No' is kept");
  assert.match(real?.costs ?? "", /\$2\/month/);
  assert.match(fixNoteInstruction(), /state its downsides and costs/);
  assert.match(fixNoteInstruction(), /how it benefits us/);
}

// ---- the instruction asks for the benefit on every change ----
assert.match(
  fixNoteInstruction(),
  /Every change must say how it helps the people who use the product/,
);

console.log("fix-note: ok");
