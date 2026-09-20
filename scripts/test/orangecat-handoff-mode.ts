/**
 * Pins the OrangeCat handoff's arrival behavior: build by default, never
 * auto-create a duplicate, always honor an explicit review request.
 * Run: npx tsx scripts/test/orangecat-handoff-mode.ts
 */
import {
  decideHandoffMode,
  interviewAutoHref,
  isInterviewAuto,
  isKickoffAuto,
  kickoffAutoHref,
} from "@/lib/integrations/orangecat-handoff-mode";

const cases: [Parameters<typeof decideHandoffMode>[0], ReturnType<typeof decideHandoffMode>][] = [
  // The one click: nothing exists yet → create and start.
  [{ review: false, connected: false, exactMatch: false }, "auto"],
  // A person asked to choose first.
  [{ review: true, connected: false, exactMatch: false }, "review"],
  // Same name, not linked: a human decides whether it is the same thing.
  [{ review: false, connected: false, exactMatch: true }, "review"],
  [{ review: true, connected: false, exactMatch: true }, "review"],
  // Already connected: nothing to create, whatever else is true.
  [{ review: false, connected: true, exactMatch: false }, "connected"],
  [{ review: true, connected: true, exactMatch: true }, "connected"],
];
for (const [input, expected] of cases) {
  const got = decideHandoffMode(input);
  if (got !== expected) {
    throw new Error(`decideHandoffMode(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
  }
}

if (kickoffAutoHref("/projects/abc") !== "/projects/abc?kickoff=auto") {
  throw new Error("auto href must append the kickoff flag");
}
if (kickoffAutoHref("/projects/abc?tab=now") !== "/projects/abc?tab=now&kickoff=auto") {
  throw new Error("auto href must respect an existing query string");
}
if (
  !isKickoffAuto("auto") ||
  isKickoffAuto(undefined) ||
  isKickoffAuto(["auto"]) ||
  isKickoffAuto("1")
) {
  throw new Error("isKickoffAuto accepts exactly the single 'auto' value");
}

// A project the handoff CREATES is asked about before it is built. The two
// flags must stay distinct: landing on ?kickoff=auto skips the interview, which
// is right for a project whose profile is already written and wrong for a brand
// new one carrying a single public sentence.
if (interviewAutoHref("/projects/abc") !== "/projects/abc?interview=auto") {
  throw new Error("interview href must append the interview flag");
}
if (interviewAutoHref("/projects/abc?tab=now") !== "/projects/abc?tab=now&interview=auto") {
  throw new Error("interview href must respect an existing query string");
}
if (interviewAutoHref("/projects/abc").includes("kickoff")) {
  throw new Error("the interview arrival must not also start the kickoff");
}
if (
  !isInterviewAuto("auto") ||
  isInterviewAuto(undefined) ||
  isInterviewAuto(["auto"]) ||
  isInterviewAuto("1")
) {
  throw new Error("isInterviewAuto accepts exactly the single 'auto' value");
}

console.log("✓ orangecat handoff mode");
