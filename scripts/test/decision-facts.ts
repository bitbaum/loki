// The facts a feedback decision card states under its headline
// (src/lib/feedback/decision-facts.ts): asked → done → next, each on its own
// line. 2026-10-11, the owner: "what was requested, … what was done on that
// front, and what else could be done".
import assert from "node:assert/strict";
import { decisionFacts } from "../../src/lib/feedback/decision-facts";

const note = {
  problem: "p",
  change: "The footer now has a Back to top link.",
  why: "w",
  considered: [],
  helps: "h",
  next: "Add the same link to long blog posts.",
  where: "footer",
  plain: "x",
};

// From the design note.
{
  const f = decisionFacts({
    suggestion: "Add a back to top link\n--- technical details ---\nua: x",
    work: {
      didLine: "ignored",
      ship: {
        state: "deployed",
        checkedAt: "",
        pr: { number: 1, url: "u", title: "t", note },
      } as never,
    },
  });
  assert.equal(
    f.asked,
    "Add a back to top link",
    "the agent-filed technical tail is not the report",
  );
  assert.equal(f.done, note.change, "the note says what was done");
  assert.equal(f.next, note.next);
}

// No note: the handoff line, and no invented next step.
{
  const f = decisionFacts({ suggestion: "x", work: { didLine: "Added the link.", ship: null } });
  assert.equal(f.done, "Added the link.");
  assert.equal(f.next, null);
}

// Nothing done yet: only what was asked.
{
  const f = decisionFacts({ suggestion: "y".repeat(500), work: null });
  assert.ok(f.asked.length <= 160);
  assert.equal(f.done, null);
}

// Every card says how it helps users; behind the scenes, what changed and the proof.
{
  const f = decisionFacts({
    suggestion: "prices were stale",
    work: {
      didLine: null,
      ship: {
        state: "deployed",
        checkedAt: "",
        pr: {
          number: 1,
          url: "u",
          title: "t",
          note: {
            ...note,
            shows: "behind",
            detail: "Retries a timed-out batch.",
            proof: "0 skipped batches last night.",
          },
        },
      } as never,
    },
  });
  assert.equal(f.helps, note.helps);
  assert.ok(f.behindTheScenes);
  assert.equal(
    f.done,
    "Retries a timed-out batch.",
    "behind the scenes, what changed in the system is what was done",
  );
  assert.equal(f.proof, "0 skipped batches last night.");
}

console.log("decision-facts: ok");
