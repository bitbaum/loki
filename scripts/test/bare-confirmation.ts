/**
 * "Yes, do it" — never work for whichever project is selected; it runs the
 * line the previous answer offered, or stays a reply. Case from the live site
 * (2026-10-15): "Yes, create it" (create projects for a podcast) was sent to
 * the bakery as a build task.
 */
import {
  demotePersonOnlyOffer,
  isBareConfirmation,
  isPersonOnlyStep,
  offeredCommand,
} from "@/lib/loki/confirmation";
import { looksLikeDispatchTask, resolveCommand } from "@/lib/command-resolve";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

for (const t of [
  "Yes, create it",
  "yes please",
  "Ok do it",
  "go ahead",
  "Sure, build that",
  "Sounds good!",
  "yep, send it",
  "Yes, let's do it",
]) {
  check(`"${t}" is a bare yes`, isBareConfirmation(t));
  check(`"${t}" is not dispatched by itself`, !looksLikeDispatchTask(t));
}
for (const t of [
  "build it",
  "Yes, add a pricing page",
  "create project night-shift",
  "ok but make the header blue",
  "yes",
  "Fix the checkout bug on bakery",
]) {
  if (t === "yes") {
    check(`"yes" alone is a bare yes`, isBareConfirmation(t));
    continue;
  }
  check(`"${t}" carries its own task`, !isBareConfirmation(t));
}

check(
  "an answer ending in one create line offers it",
  offeredCommand(
    "You have one project.\n\nTo track the podcast:\n\n**create project night-shift**",
  ) === "create project night-shift",
);
check(
  "an instruction line for a project is offered",
  offeredCommand("Do this next.\n**bakery: add a menu page and ship**") ===
    "bakery: add a menu page and ship",
);
check(
  "two offered lines are a choice, not an offer",
  offeredCommand("**create project a**\n**create project b**") === null,
);
check(
  "bold inside a sentence is emphasis",
  offeredCommand("This is **really** important.") === null,
);
check(
  "a bold line that is not a command is not offered",
  offeredCommand("Plan:\n**Not in your data.**") === null,
);
check("no answer, no offer", offeredCommand(undefined) === null);

// Live, 2026-10-17: a person-only step in command shape.
const installOffer =
  "Nothing can build until a computer is connected.\n**prodtest-bakery: install the Fleet Runner desktop app and connect it**";
check(
  "a step only the person can take is not offered to a yes",
  offeredCommand(installOffer) === null,
);
for (const line of [
  "bakery: sign in to GitHub and approve the request",
  "bakery: approve the calendar draft",
  "bakery: add your API key in Settings",
  "bakery: verify your email",
  "bakery: decide whether to keep the old menu",
  "bakery: restart the Fleet Runner",
]) {
  check(`"${line}" is the person's step`, isPersonOnlyStep(line));
}
for (const line of [
  "bakery: add a sign-in page with email login",
  "bakery: fix the 3 open reports and ship",
  "bakery: install the analytics package and add a cookie banner",
  "create project night-shift",
  "bakery: add a pay button and a subscribe form",
]) {
  check(`"${line}" is agent work`, !isPersonOnlyStep(line));
}
check(
  "the person-only line is rewritten as a plain sentence",
  demotePersonOnlyOffer(installOffer).endsWith(
    "\nInstall the Fleet Runner desktop app and connect it.",
  ),
);
check(
  "an agent offer is left exactly as written",
  demotePersonOnlyOffer("Do this.\n**bakery: add a menu page**") ===
    "Do this.\n**bakery: add a menu page**",
);

async function main() {
  const r = await resolveCommand({
    text: "Yes, create it",
    projects: ["prodtest-bakery"],
    selectedProject: "prodtest-bakery",
  });
  check(
    "with one project selected, a bare yes resolves as chat",
    r.kind === "chat" && r.projectKey === null,
  );
  console.log(`\nbare-confirmation: ${passed} passed`);
}
void main();
