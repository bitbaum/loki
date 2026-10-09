// What the headphones say unasked: coalesced by kind, most urgent first,
// varied so the same news does not come in the same words every time, each
// behind the right earcon, and held back in "important" mode so finished runs
// arrive as one sentence instead of a running commentary.
import assert from "node:assert/strict";
import {
  detailsFor,
  earconFor,
  phraseChanges,
  phraseHeld,
  splitByMode,
  type FleetChange,
} from "../../src/lib/voice/announce";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

const finished = (project: string, note: string | null = null): FleetChange => ({
  kind: "finished",
  project,
  note,
});

check(() => {
  // Three finished runs are one sentence, not three.
  const out = phraseChanges([finished("heidi"), finished("solon"), finished("orangecat")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].earcon, "finished");
  assert.match(out[0].text, /^three runs finished: heidi, solon and orangecat\./);
});

check(() => {
  // Urgency order: the builder dropping comes before a run finishing, whatever the input order.
  const out = phraseChanges([
    finished("heidi"),
    { kind: "builder-offline" },
    { kind: "approval", id: "a", title: "Reply to Anna" },
  ]);
  assert.deepEqual(
    out.map((a) => a.earcon),
    ["offline", "attention", "finished"],
  );
});

check(() => {
  // Variants differ in words, never in facts.
  const one = [finished("heidi", "Header fits.")];
  const a = phraseChanges(one, 0)[0].text;
  const b = phraseChanges(one, 1)[0].text;
  assert.notEqual(a, b);
  assert.ok(a.includes("heidi") && b.includes("heidi"));
  assert.ok(a.includes("Header fits.") && b.includes("Header fits."));
  // And the rotation wraps.
  assert.equal(phraseChanges(one, 3)[0].text, a);
});

check(() => {
  const { now, held } = splitByMode(
    [
      finished("heidi"),
      { kind: "failed", project: "solon", note: "tsc" },
      { kind: "started", project: "x" },
    ],
    "important",
  );
  assert.deepEqual(
    now.map((c) => c.kind),
    ["failed"],
  );
  assert.deepEqual(
    held.map((c) => c.kind),
    ["finished", "started"],
  );
  const all = splitByMode(now.concat(held), "everything");
  assert.equal(all.held.length, 0);
});

check(() => {
  assert.equal(phraseHeld([{ kind: "started", project: "x" }]), null);
  const d = phraseHeld([finished("heidi"), finished("heidi"), finished("solon")], 0);
  assert.ok(d);
  assert.match(d.text, /three runs finished on heidi and solon/);
  assert.equal(d.earcon, "finished");
});

check(() => {
  assert.equal(
    detailsFor([
      finished("heidi", "## Done\nHeader **fits**."),
      { kind: "failed", project: "solon", note: null },
    ]),
    "heidi finished: Done Header fits. solon failed, and left no note.",
  );
  assert.equal(detailsFor([{ kind: "builder-online" }]), "Nothing to add.");
});

check(() => {
  assert.equal(earconFor("failed"), "failed");
  assert.equal(earconFor("approval"), "attention");
  assert.equal(earconFor("builder-offline"), "offline");
  assert.equal(earconFor("started"), "finished");
});

console.log(`voice-announce: ${n} checks ok`);
