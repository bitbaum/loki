/**
 * Two owner-only, per-project, default-off switches decide what may START a
 * build beyond the owner's own word: an agent's report building unasked, and
 * editors dispatching onto the owner's builder. Filing alone never builds.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Storage: nullable, no default — never chosen, never on.
const schema = read("src/db/schema/user-projects.ts");
assert.match(schema, /agentBuildsUnasked: boolean\("agent_builds_unasked"\),/);
assert.match(schema, /editorsMayBuild: boolean\("editors_may_build"\),/);
assert.doesNotMatch(schema, /agent_builds_unasked"\)\.(notNull|default)/);
assert.doesNotMatch(schema, /editors_may_build"\)\.(notNull|default)/);

// Ingest: builds only behind the opt-in, through the owner's own build path.
// The filing body both doors call (the seat's route and the OrangeCat rail).
const ingest = read("src/lib/feedback/agent-filing.ts");
const post = ingest.slice(
  ingest.indexOf("export async function fileAgentFeedback"),
  ingest.indexOf("export async function readFeedbackStatus"),
);
assert.match(
  read("src/app/api/projects/[id]/feedback/route.ts"),
  /fileAgentFeedback\(userId, idOrResp, access, data\)/,
);
assert.match(post, /agentBuildsUnasked !== true\) return respond\(stored\.row, false\)/);
assert.match(post, /startOwnerBuild\(access\.ownerUserId/, "the owner's builder and daily limit");
assert.ok(
  post.indexOf("agentBuildsUnasked") < post.indexOf("startOwnerBuild("),
  "the opt-in is checked before any build starts",
);
assert.equal(post.match(/startOwnerBuild\(/g)?.length, 1, "one build site");
assert.match(
  post,
  /if \(stored\.replayed\) return respond\(stored\.row, true\)/,
  "a retry never builds",
);

// Dispatch: the owner, or an editor the owner granted — never another seat.
const impl = read("src/lib/feedback/implement.ts");
assert.match(impl, /if \(actorUserId !== row\.ownerUserId\)/);
assert.match(impl, /row\.canEdit/);
assert.match(impl, /grant\?\.editorsMayBuild !== true/);
assert.match(impl, /executionUserId = row\.ownerUserId/, "the run is still the owner's");

// The switches are the owner's: a session matched to the owner's own row.
const grants = read("src/app/api/projects/[id]/build-grants/route.ts");
assert.match(grants, /getSessionUserId\(\)/);
assert.doesNotMatch(grants, /getApiUserId|getProjectAccess/, "no Bearer token, no seat sets these");
assert.match(grants, /setProjectBuildGrants\(userId, idOrResp, data\)/);
const q = read("src/db/queries/user-projects.ts");
assert.match(q, /eq\(userProjects\.userId, ownerUserId\)/);

console.log("agent-build-grants ok");
