/**
 * Pins the failure → remedy classifier.
 * Run: npx tsx scripts/test/failure-remedy.ts
 */
import { FAILURE_PHRASE, FAILURE_REMEDY, remedyForFailure } from "@/lib/failure-remedy";

const cases: [string | null, string][] = [
  [
    'no running agent for "heidi" on this runner — dispatch to start one',
    FAILURE_REMEDY.START_SESSION,
  ],
  ['No running agent for "Heidi" — dispatch to start one', FAILURE_REMEDY.START_SESSION],
  [
    "Grok is not installed on the cloud builder, so nothing was started. Switch this project to an agent installed there, or install Grok on the cloud builder, then try again.",
    FAILURE_REMEDY.SWITCH_AGENT,
  ],
  ["spawnSync /bin/sh ETIMEDOUT", FAILURE_REMEDY.RETRY],
  ["", FAILURE_REMEDY.RETRY],
  [null, FAILURE_REMEDY.RETRY],
];
for (const [input, expected] of cases) {
  const got = remedyForFailure(input);
  if (got !== expected)
    throw new Error(`remedyForFailure(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
}
// Every phrase must classify to something other than the default, or it is dead.
for (const phrase of Object.values(FAILURE_PHRASE)) {
  if (remedyForFailure(`prefix ${phrase} suffix`) === FAILURE_REMEDY.RETRY) {
    throw new Error(`phrase ${JSON.stringify(phrase)} falls to the default`);
  }
}
console.log("✓ failure remedy");
