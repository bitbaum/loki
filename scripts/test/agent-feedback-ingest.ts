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

// The route: Bearer-capable auth, the seat check, no build started, one retry key.
const route = read("src/app/api/projects/[id]/feedback/route.ts");
const post = route.slice(route.indexOf("export async function POST"));
assert.match(post, /getApiUserId\(\)/, "Bearer or session");
assert.match(post, /getProjectAccess\(userId, idOrResp\)/, "the seat decides");
assert.match(post, /FEEDBACK_SOURCE\.AGENT/);
assert.match(post, /agentName/);
assert.match(post, /idempotencyKey/);
assert.match(post, /statusUrl/);
assert.doesNotMatch(post, /startOwnerBuild|implementFeedback|dispatch/, "filing never builds");
assert.doesNotMatch(post, /canEdit/, "a reporter seat may file");

// Attachments: the same schema object as the widget's ingest, not a copy.
assert.match(route, /\.\.\.FeedbackAttachmentsSchema/);
assert.match(read("src/app/api/feedback/route.ts"), /\.\.\.FeedbackAttachmentsSchema/);
assert.match(post, /captureContext: data\.context/);
assert.match(post, /moments: data\.moments/);

// Storage: one row per (project, key).
const schema = read("src/db/schema/site-feedback.ts");
assert.match(schema, /uq_site_feedback_idempotency/);
assert.match(schema, /agentName: text\("agent_name"\)/);

console.log("agent-feedback-ingest ok");
