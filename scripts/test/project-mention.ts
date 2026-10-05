/**
 * Regression coverage for the phone session of 2026-08-18.
 *
 * The operator typed, on /loki:
 *
 *   "I want you to tell me what is left to do with Orange Cat for it to work
 *    properly."
 *
 * and got "Which project should I run that on?" over a grid of nine project
 * chips — none of them the project they had just named. Two independent bugs
 * had to line up to produce that, and both are covered here:
 *
 *   1. Project matching was `text.includes(name)` on the raw slug, so the
 *      registered `orangecat` never matched the typed "Orange Cat".
 *   2. looksLikeDispatchTask treated any sentence over 16 characters containing
 *      " for "/" on "/" in " as work to dispatch. "for it to work" qualified, so
 *      a question was routed to an agent instead of being answered.
 *
 * Run: npx tsx scripts/test/project-mention.ts (or npm run test:unit)
 */
import {
  projectMentionedIn,
  resolveProjectFromContext,
  textMentionsProject,
  unknownProjectMention,
} from "@/lib/project-mention";
import { looksLikeDispatchTask } from "@/lib/command-resolve";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  check(`${label} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));
}

// The fleet as it stood on the day, in the order the picker rendered it.
const FLEET = [
  "Bitbaum",
  "BiasLens",
  "Zeitkastli",
  "Prime tower",
  "lifeops",
  "aoz-begleitung",
  "botsmann",
  "datacat",
  "loki",
  "orangecat",
];

console.log("project-mention — spacing/case tolerance");
eq(
  projectMentionedIn("what is left to do with Orange Cat", FLEET),
  "orangecat",
  "the reported case",
);
eq(projectMentionedIn("push orangecat please", FLEET), "orangecat", "exact slug still matches");
eq(projectMentionedIn("check OrangeCat's build", FLEET), "orangecat", "camel case");
eq(projectMentionedIn("look at orange-cat", FLEET), "orangecat", "hyphenated");
eq(
  projectMentionedIn("the AOZ Begleitung rebuild", FLEET),
  "aoz-begleitung",
  "slug with a hyphen, typed with a space",
);
eq(
  projectMentionedIn("deploy prime tower", FLEET),
  "Prime tower",
  "registered name keeps its own casing in the answer",
);

console.log("\nproject-mention — no invented matches");
eq(projectMentionedIn("nothing relevant here", FLEET), null, "unrelated prose matches nothing");
check(
  "a project name is not found inside a longer word",
  !textMentionsProject("going somewhere", "go"),
);
check("partial token runs do not match", !textMentionsProject("orange", "orangecat"));
eq(
  projectMentionedIn("compare aoz to the aoz-begleitung plan", ["aoz", "aoz-begleitung"]),
  "aoz-begleitung",
  "the longer, more specific name wins",
);

console.log("\nproject-mention — selection outranks prose");
eq(
  resolveProjectFromContext("work on Orange Cat", "datacat", FLEET),
  "datacat",
  "an explicit pick wins",
);
eq(
  resolveProjectFromContext("work on Orange Cat", undefined, FLEET),
  "orangecat",
  "falls back to the name in the text",
);

console.log("\nproject-mention — naming something we don't have");
const noOrangeCat = FLEET.filter((p) => p !== "orangecat");
eq(
  unknownProjectMention("what is left to do with Orange Cat for it to work", noOrangeCat),
  "Orange Cat",
  "reports the operator's own words back",
);
eq(
  unknownProjectMention("code review for “Red Dog”", noOrangeCat),
  "Red Dog",
  "a quoted phrase counts as a name",
);
eq(
  unknownProjectMention("what is left to do with Orange Cat", FLEET),
  null,
  "silent when the project IS registered",
);
eq(unknownProjectMention("fix the tests", FLEET), null, "silent on ordinary prose");
eq(unknownProjectMention("remind me on Monday", FLEET), null, "a weekday is not a project");

console.log("\ncommand-resolve — asking is not dispatching");
check(
  "the reported sentence is a question, not work",
  !looksLikeDispatchTask(
    "I want you to tell me what is left to do with Orange Cat for it to work properly.",
  ),
);
check("tell me …", !looksLikeDispatchTask("tell me how the deploy pipeline works for loki"));
check(
  "can you explain …",
  !looksLikeDispatchTask("Can you explain what changed in datacat on Friday"),
);
check(
  "give me a rundown …",
  !looksLikeDispatchTask("give me a rundown of what is blocked on botsmann"),
);
check(
  "I need to know …",
  !looksLikeDispatchTask("I need to know whether the migration ran in lifeops"),
);
check(
  "a pronoun-led sentence is not an instruction",
  !looksLikeDispatchTask("we should probably think about the pricing page in a while"),
);
check(
  "a capability question is a question, even without its question mark",
  !looksLikeDispatchTask("Are you able to work on improving Loki in this field."),
);
check(
  "is it possible …",
  !looksLikeDispatchTask("is it possible to run the deploy on lifeops from here"),
);
check("do you know …", !looksLikeDispatchTask("do you know what is running on the cloud builder"));

console.log("\ncommand-resolve — work is still work");
check("imperative with a verb", looksLikeDispatchTask("fix the failing tests in loki"));
check("build handoff", looksLikeDispatchTask("ok let's build it"));
check("explicit implement", looksLikeDispatchTask("implement the invite flow for botsmann"));
check(
  "verb-led with no keyword verb",
  looksLikeDispatchTask("ship the parser rewrite for datacat"),
);
check(
  "an action question still dispatches",
  looksLikeDispatchTask("can you fix the failing types in lifeops?"),
);

console.log(`\n${passed}/${passed} project-mention cases passed`);
