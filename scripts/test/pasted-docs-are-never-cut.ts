/**
 * A pasted document is never silently cut, and a refusal says why.
 *
 * 2026-09-25, Skif: the owner's 8,542-character doctrine went into "Sync from
 * doc". The textarea's maxLength (8,000) would have dropped the last 542
 * characters without a word, and the server, given the whole thing, answered
 * "Paste the doc — at least a sentence" — a too-LONG text told it was too short.
 * The same maxLength sat on "Describe it" and the kickoff brief.
 *
 * Run: npx tsx scripts/test/pasted-docs-are-never-cut.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pastedText, PASTE_TOO_LONG } from "@/lib/api/pasted-text";
import { DOC_PASTE_MAX } from "@/lib/constants";
import { charCountState } from "@/components/ui/char-count";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const schema = pastedText("Paste the doc — at least a sentence.");
const tooShort = schema.safeParse("hi");
assert(
  !tooShort.success && tooShort.error.issues[0]?.message === "Paste the doc — at least a sentence.",
  "a too-short paste is told it is too short",
);
const tooLong = schema.safeParse("x".repeat(DOC_PASTE_MAX + 1));
assert(
  !tooLong.success && tooLong.error.issues[0]?.message === PASTE_TOO_LONG,
  "a too-long paste is told it is too LONG — never 'at least a sentence'",
);
assert(/\d/.test(PASTE_TOO_LONG), "the too-long message names the limit, so it can be acted on");
assert(
  schema.safeParse("x".repeat(8_542)).success,
  "a real concept doc (Skif's doctrine, 8,542 chars) fits",
);

// The counter: quiet when short, shown as it fills, and says OVER past the cap.
assert(!charCountState(100, 1000).visible, "a short text shows no counter");
assert(
  charCountState(700, 1000).visible && !charCountState(700, 1000).over,
  "near the cap it counts",
);
assert(charCountState(1001, 1000).over, "past the cap it says over");

// No doc box truncates with maxLength — that is the silent cut.
const root = join(__dirname, "../..");
for (const file of [
  "src/components/projects/ProjectDocSync.tsx",
  "src/components/projects/ProjectBriefFill.tsx",
  "src/components/projects/ProjectKickoff.tsx",
]) {
  const src = readFileSync(join(root, file), "utf8");
  assert(
    !/maxLength=/.test(src),
    `${file} truncates a paste with maxLength — show <CharCount> instead`,
  );
  assert(/<CharCount\b/.test(src), `${file} must show how much of the limit is used`);
}
for (const route of ["brief", "roadmap", "reconcile"]) {
  const src = readFileSync(join(root, `src/app/api/projects/[id]/${route}/route.ts`), "utf8");
  assert(
    /pastedText\(/.test(src),
    `the ${route} route validates with the shared pastedText schema`,
  );
}
// reconcile parses by hand, and it was the one answering every failure with a
// fixed "at least a sentence". It must pass the schema's own message through.
const reconcile = readFileSync(join(root, "src/app/api/projects/[id]/reconcile/route.ts"), "utf8");
assert(
  /error:\s*parsed\.error\.issues\[0\]\?\.message/.test(reconcile),
  "reconcile returns the schema's message, so too-long is not reported as too-short",
);

console.log("✓ pasted docs are never cut");
