/**
 * An agent files a report with its own seat's Bearer token on
 * POST /api/projects/[id]/feedback. Filing is not building: the row is
 * source "agent", which waits for a tap, and every seat may file.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { capabilitiesForRole } from "../../src/lib/project-capabilities";
import {
  FEEDBACK_SELF_ASSERTED_SOURCES,
  FEEDBACK_SOURCE,
  FEEDBACK_SOURCE_VALUES,
  waitsForATap,
} from "../../src/lib/constants/statuses";

const read = (p: string) => readFileSync(p, "utf8");

// Source: known, never self-asserted on the public widget route, never builds unasked.
assert.ok(FEEDBACK_SOURCE_VALUES.includes("agent"));
assert.equal(FEEDBACK_SOURCE.AGENT, "agent");
assert.ok(!(FEEDBACK_SELF_ASSERTED_SOURCES as readonly string[]).includes("agent"));
assert.equal(waitsForATap(FEEDBACK_SOURCE.AGENT), true, "an agent's report waits for a tap");

// Seats: getProjectAccess gives every role (owner, editor, client, viewer) a
// non-null access, so any seat may file; only owner and editor may edit
// (and so dispatch, PR 3).
assert.equal(capabilitiesForRole("owner").canEdit, true);
assert.equal(capabilitiesForRole("editor").canEdit, true);
assert.equal(capabilitiesForRole("client").canEdit, false);
assert.equal(capabilitiesForRole("viewer").canEdit, false);

// The route: Bearer-capable auth and the seat check, then the one filing body
// (lib/feedback/agent-filing), which the signed OrangeCat door calls too.
const route = read("src/app/api/projects/[id]/feedback/route.ts");
const door = route.slice(route.indexOf("export async function POST"));
assert.match(door, /getApiUserId\(\)/, "Bearer or session");
assert.match(door, /getProjectAccess\(userId, idOrResp\)/, "the seat decides");
assert.match(door, /fileAgentFeedback\(userId, idOrResp, access, data\)/);
assert.doesNotMatch(door, /implementFeedback|dispatch|canEdit/);
const filingLib = read("src/lib/feedback/agent-filing.ts");
const post = filingLib.slice(
  filingLib.indexOf("export async function fileAgentFeedback"),
  filingLib.indexOf("export async function readFeedbackStatus"),
);
// The other door: signed, the linked account, the same body. Words only.
const rail = read("src/app/api/orangecat/feedback/route.ts");
assert.match(rail, /readSignedOrangeCatBody\(/);
assert.match(rail, /isFreshIssuedAt\(/);
assert.match(rail, /getProjectAccess\(user\.id, project\.entityProjectId\)/, "the seat decides");
assert.match(rail, /fileAgentFeedback\(user\.id, project\.entityProjectId, access,/);
assert.doesNotMatch(
  rail,
  /insertSiteFeedback|insertAgentFeedback|startOwnerBuild/,
  "no second body",
);
assert.match(post, /FEEDBACK_SOURCE\.AGENT/);
assert.match(post, /agentName/);
assert.match(post, /idempotencyKey/);
assert.match(post, /statusUrl/);
assert.doesNotMatch(post, /implementFeedback|dispatch/, "filing never dispatches directly");
// Filing alone never builds: the one build site sits behind the owner's opt-in
// (scripts/test/agent-build-grants.ts pins the order).
assert.equal(post.match(/startOwnerBuild\(/g)?.length, 1);
assert.match(post, /agentBuildsUnasked !== true\) return respond/);
assert.doesNotMatch(post, /canEdit/, "a reporter seat may file");

// Attachments: the same schema object as the widget's ingest, not a copy.
assert.match(filingLib, /\.\.\.FeedbackAttachmentsSchema/);
assert.match(read("src/app/api/feedback/route.ts"), /\.\.\.FeedbackAttachmentsSchema/);
assert.match(post, /captureContext: data\.context/);
assert.match(post, /moments: data\.moments/);

// Storage: one row per (project, key).
const schema = read("src/db/schema/site-feedback.ts");
assert.match(schema, /uq_site_feedback_idempotency/);
assert.match(schema, /agentName: text\("agent_name"\)/);

console.log("agent-feedback-ingest ok");
