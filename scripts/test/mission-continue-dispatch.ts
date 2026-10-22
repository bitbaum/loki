import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missionContinueOffer } from "@/lib/missions/continue-offer";

const base = {
  canEdit: true,
  buildStatus: "idle" as const,
  hasRepo: true,
  hasQueuedNextStep: true,
  hasBriefOrGoals: true,
};

assert.deepEqual(missionContinueOffer(base), { type: "dispatch", kind: "next_step" });
assert.deepEqual(missionContinueOffer({ ...base, hasQueuedNextStep: false }), {
  type: "dispatch",
  kind: "kickoff",
});
assert.deepEqual(
  missionContinueOffer({ ...base, hasQueuedNextStep: false, hasBriefOrGoals: false }),
  { type: "setup", reason: "no_brief" },
);
assert.deepEqual(missionContinueOffer({ ...base, hasRepo: false }), {
  type: "setup",
  reason: "no_repo",
});
assert.deepEqual(missionContinueOffer({ ...base, canEdit: false }), { type: "read_only" });

for (const state of ["building", "queued", "needs_you", "stalled"] as const) {
  assert.deepEqual(
    missionContinueOffer({ ...base, buildStatus: state }),
    { type: "watch", reason: state },
    `do not dispatch over a ${state} run`,
  );
  assert.deepEqual(
    missionContinueOffer({ ...base, buildStatus: state, hasRepo: false }),
    { type: "watch", reason: state },
    "inspect active state before guessing setup failures",
  );
}
assert.deepEqual(
  missionContinueOffer({ ...base, canEdit: false, buildStatus: "building" }),
  { type: "read_only" },
  "no interaction or leak of runtime detail for a view-only collaborator",
);

const page = readFileSync("src/app/(app)/missions/[id]/page.tsx", "utf8");
const action = readFileSync("src/components/missions/MissionContinueAction.tsx", "utf8");
const dispatchRoute = readFileSync("src/app/api/projects/[id]/dispatch/route.ts", "utf8");
const dispatchStep = readFileSync("src/lib/kickoff/steps.ts", "utf8");

assert.match(page, /getProjectDossier\(userId, id\)/);
assert.match(page, /getProjectAccess\(userId, id\)/);
assert.match(page, /deriveBuildStatus\(/);
assert.match(page, /missionContinueOffer\(/);
assert.match(page, /access\.ownerUserId === dossier\.ownerId/);
assert.match(action, /useProjectDispatch\(projectId\)/);
assert.match(action, /dispatch\(offer\.kind\)/);
assert.match(action, /disabled={state\.phase === "sending"}/);
assert.match(action, /router\.refresh\(\)/);
assert.doesNotMatch(action, /fetch\(/, "keep the existing project's dispatch client");
assert.match(dispatchRoute, /getApiUserId\(\)/);
assert.match(dispatchRoute, /dispatchStep\(userId, idOrResp, dataOrResp\)/);
assert.match(dispatchStep, /getProjectAccess\(userId, id\)/);
assert.match(dispatchStep, /if \(!access\.canEdit\)/);
assert.match(dispatchStep, /injectPrompt\(/);
assert.doesNotMatch(page + action, /export async function POST\(/);

console.log("✓ Mission continue: same permissioned dispatch, never double-dispatch an active run");
