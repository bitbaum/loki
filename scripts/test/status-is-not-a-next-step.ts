/**
 * Two places where Loki reported a status as if it were something else.
 *
 * 1. Registering a site wrote "Live site: <url>" into the owner's next_step.
 *    Control showed it as "Suggested next", and every dispatch briefed the
 *    agent with it (Skif, 2026-09-25). A status is not a step.
 * 2. Today counted "running" from prompts STARTED in a window, so a dead
 *    agent still counted: Today said "2 running" while Control said "1
 *    working" and no run was open.
 *
 * Run: npx tsx scripts/test/status-is-not-a-next-step.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRegistrationNextStep } from "@/lib/site-cd";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Registration's own messages are recognised, so they can be cleared on success.
for (const own of [
  "Live site: https://skif.orangecat.ch",
  "Deployment queued. The live link appears after deployment and a public check pass.",
  "Register CD on the studio box: bash scripts/hetzner/register-site.sh skif",
  "Could not start deployment (GitHub HTTP 502). Retry registration.",
  "register-site.sh failed — run manually. …",
  "Auto-register unavailable — bash scripts/hetzner/register-site.sh skif",
]) {
  assert(isRegistrationNextStep(own), `registration's own message not recognised: ${own}`);
}
// The owner's words are never mistaken for it, so they are never cleared.
for (const owner of [
  "Book the specialists your Safety Plan suggests",
  "Ship the live site redesign",
  "",
  null,
  undefined,
]) {
  assert(!isRegistrationNextStep(owner), `an owner's next step would be cleared: ${owner}`);
}

const root = join(__dirname, "../..");
const register = readFileSync(join(root, "src/lib/site-cd-register.ts"), "utf8");
assert(
  !/NEXT_STEP,\s*status === "live" \? `Live site:/.test(register),
  'registration writes "Live site: …" into next_step again',
);

const today = readFileSync(join(root, "src/db/queries/today.ts"), "utf8");
const summary = today.slice(today.indexOf("export async function getFleetSummary"));
assert(
  /const running = Object\.keys\(await getOpenAgentTurnsByProject\(userId\)\)\.length/.test(
    summary,
  ),
  "Today's running count must come from live agent turns, the source Control uses",
);

console.log("✓ a status is not a next step, and Today's running agrees with Control");
