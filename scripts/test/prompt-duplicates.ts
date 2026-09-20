/**
 * What the saved-prompts section hides, and what it must admit.
 *
 * Found by looking at /prompts on prod, 2026-09-18. Two cards titled
 * "Next Best Step" sat side by side — same title, same clamped summary, same
 * four tags — under a header reading "2 saved · most-recent first". Nothing on
 * either card said which was which, and the field the ordering rests on
 * (updatedAt) was carried into the component and never rendered.
 *
 * Underneath, the API returned EIGHT rows, all named "Next Best Step", in two
 * groups of four byte-identical bodies. The render-time dedupe is right to fold
 * them — it was added after a smoke session forked a default seven times — but
 * folding silently made delete look broken: a card stands for a whole group, so
 * deleting it draws the next identical row in its place and the prompt appears
 * to come back.
 *
 * Run: npx tsx scripts/test/prompt-duplicates.ts
 */
import { collapseDuplicates, dupeKey } from "@/components/prompts/UserPromptsSection";
import type { UserPromptCard } from "@/components/prompts/UserPromptsSection";

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

const P = (over: Partial<UserPromptCard>): UserPromptCard => ({
  id: Math.random().toString(36).slice(2),
  name: "Next Best Step",
  description: "Autonomously determine and execute the single highest-impact task right now",
  body: "A".repeat(1011),
  scope: "global",
  projectId: null,
  orgId: null,
  tags: ["global", "autonomous", "agent", "execution"],
  source: "fork",
  forkedFromKey: null,
  runCount: 0,
  successCount: 0,
  updatedAt: "2026-08-15T10:25:11.001Z",
  ...over,
});

console.log("prompt-duplicates:");

check("identical rows collapse to one card", () => {
  const { visible } = collapseDuplicates([P({}), P({}), P({}), P({})]);
  assert(visible.length === 1, `expected 1 card, got ${visible.length}`);
});

check("the card reports how many rows it stands for", () => {
  // THE MISSING HALF. Without this the page says "2 saved" over 8 rows, and
  // deleting a card looks like it did nothing.
  const rows = [P({}), P({}), P({}), P({})];
  const { visible, copies } = collapseDuplicates(rows);
  assert(
    copies.get(dupeKey(visible[0])) === 4,
    `expected 4 copies, got ${copies.get(dupeKey(visible[0]))}`,
  );
});

check("the newest row is the one kept", () => {
  // The list arrives most-recent first, so the survivor must be the head of
  // its group — the card's "saved <when>" has to describe a real row.
  const newest = P({ updatedAt: "2026-08-15T10:25:11.001Z", id: "newest" });
  const older = P({ updatedAt: "2026-07-14T22:42:08.809Z", id: "older" });
  const { visible } = collapseDuplicates([newest, older]);
  assert(visible[0].id === "newest", `kept ${visible[0].id}`);
});

check("prompts that differ in body are NOT collapsed", () => {
  // The two cards on prod differed only past the clamp (1011 vs 860 chars).
  // Folding them would delete a real prompt from view.
  const long = P({ body: "A".repeat(1011) });
  const short = P({ body: "A".repeat(860) });
  const { visible } = collapseDuplicates([long, short]);
  assert(visible.length === 2, `expected both, got ${visible.length}`);
});

check("the exact prod shape: 8 rows, two groups of four, two cards", () => {
  const rows = [
    ...Array.from({ length: 4 }, () => P({ body: "A".repeat(1011) })),
    ...Array.from({ length: 4 }, () => P({ body: "A".repeat(860) })),
  ];
  const { visible, copies } = collapseDuplicates(rows);
  assert(visible.length === 2, `expected 2 cards, got ${visible.length}`);
  assert(
    visible.every((v) => copies.get(dupeKey(v)) === 4),
    "each card should stand for 4 rows",
  );
});

check("a single prompt claims no copies", () => {
  // The line must not appear on an ordinary card.
  const { visible, copies } = collapseDuplicates([P({})]);
  assert(copies.get(dupeKey(visible[0])) === 1, "one row, one copy");
});

check("name and body are BOTH part of identity", () => {
  // Same body, different name is a different prompt — and vice versa.
  const a = P({ name: "Next Best Step" });
  const b = P({ name: "Continue Task" });
  assert(dupeKey(a) !== dupeKey(b), "name must matter");
  assert(dupeKey(a) !== dupeKey(P({ body: "different" })), "body must matter");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
