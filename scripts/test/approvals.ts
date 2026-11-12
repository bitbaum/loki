/**
 * An agent's permission prompt surfaces in Loki and is answered without the
 * terminal: by a person in the UI, by an agent with its token over the API,
 * or over MCP (src/lib/approvals.ts, src/db/queries/approvals.ts).
 *
 * 2026-11-12: cloud sessions sat on unanswerable prompts for 6+ minutes (an
 * "Update Environment" request pending 04:59-05:05 then denied, "Add Repo
 * push" from 05:04, "Get Environment" from 05:11). The database half (scope,
 * audit, races) is scripts/test/approvals-db.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  approvalChoices,
  approvalHeadline,
  approvalId,
  approvalKeys,
  approvalKind,
  parseApprovalId,
  type PendingApproval,
} from "../../src/lib/approvals";
import { alignLiveViewWithTrack } from "../../src/lib/dispatch-status";
import { callTool } from "../../src/lib/mcp/tools";
import { MCP_SCOPE, MCP_TOOL_SCOPES } from "../../src/config/mcp";
import type { McpServices } from "../../src/lib/mcp/types";

const read = (p: string) => fs.readFileSync(p, "utf8");
const RUN = "0b6f0a5e-1111-4000-8000-000000000001";

// ── what a prompt is ─────────────────────────────────────────────────────────
assert.equal(approvalKind("Do you want to proceed?"), "tool");
assert.equal(approvalKind("Do you trust the files in this folder?"), "trust");
assert.equal(approvalKind("Would you like to proceed with this plan?"), "plan");
assert.equal(approvalKind("Allow Update Environment?"), "environment");
assert.deepEqual(approvalChoices("trust"), ["allow_once", "deny"], "a trust dialog has no always");
assert.deepEqual(approvalChoices("tool"), ["allow_once", "allow_always", "deny"]);

// ── which keys answer it ─────────────────────────────────────────────────────
assert.equal(approvalKeys("allow_once", "claude", "tool"), "1");
assert.equal(approvalKeys("allow_always", "claude", "tool"), "2");
assert.equal(approvalKeys("deny", "claude", "tool"), "\u001b", "deny is Escape");
assert.equal(approvalKeys("allow_once", "gemini", "environment"), "1");
assert.equal(approvalKeys("allow_always", "claude", "trust"), null, "never a wrong key");
assert.equal(approvalKeys("allow_once", "codex", "tool"), null, "unknown menu: refuse, not guess");
assert.equal(approvalKeys("deny", "codex", "tool"), "\u001b", "Escape denies anywhere");

// ── an id names the run AND the question ─────────────────────────────────────
const id = approvalId(RUN, "Do you want to proceed?");
assert.deepEqual(parseApprovalId(id)?.runId, RUN);
assert.notEqual(id, approvalId(RUN, "Do you want to make this edit?"), "a new question, a new id");
assert.equal(parseApprovalId("../../etc"), null);

// ── "Waiting for your approval: <what>" with how long ────────────────────────
const now = Date.parse("2026-11-12T05:05:00Z");
assert.equal(
  approvalHeadline("Allow Update Environment?", "2026-11-12T04:59:00Z", now),
  "Waiting for your approval: Allow Update Environment? (waiting for 6 minutes)",
);
assert.match(
  approvalHeadline("", null, now),
  /^Waiting for your approval: permission to run a tool$/,
);

// ── the canonical status is waiting_approval, never "working" ────────────────
const working = {
  status: "working",
  label: "Agent is working",
  detail: "",
  tone: "positive",
  terminal: false,
} as Parameters<typeof alignLiveViewWithTrack>[0];
const aligned = alignLiveViewWithTrack(working, {
  live: "waiting_approval",
  summary: "Waiting for your approval: Allow Update Environment? (waiting for 6 minutes)",
} as Parameters<typeof alignLiveViewWithTrack>[1]);
assert.equal(aligned.status, "waiting_approval");
assert.equal(aligned.label, "Waiting for your approval");
const track = read("src/lib/run-track.ts");
assert.match(
  track,
  /if \(f\.input\.awaitingApproval\) return "waiting_approval";\n\s*if \(work\.state === "attention"/,
);
assert.match(
  read("src/lib/run-track-load.ts"),
  /run\.payload\?\.blocked === RUN_BLOCKED\.PERMISSION/,
);

// ── the wiring ───────────────────────────────────────────────────────────────
const list = read("src/app/api/sessions/[tab]/pending-approvals/route.ts");
assert.match(list, /getApiActor\(\)/, "a session or the account's own token");
assert.match(list, /listPendingApprovals\(actor\.userId,/, "the caller's own runs only");
const answer = read("src/app/api/sessions/[tab]/approvals/[id]/route.ts");
assert.match(
  answer,
  /answeredBy: \{ userId: actor\.userId, via: actor\.via \}/,
  "audited: who and how",
);
const q = read("src/db/queries/approvals.ts");
assert.match(q, /eq\(orchestrationRuns\.userId, userId\)/, "owner-scoped read");
assert.match(q, /if \(approval\.id !== input\.approvalId\)/, "a changed question is refused");
assert.match(q, /if \(isShellTab\(session\.tab\)\)/, "never a shell");
assert.ok(
  q.indexOf("if (cleared.length === 0)") < q.indexOf("await publishFastLaneEvent("),
  "claimed before a key is typed, so two answers cannot both press",
);
assert.match(q, /emitRunEvent\(run\.id, input\.userId, "approval", answer\)/);
assert.match(read("src/db/queries/orchestration-runs.ts"), /'\{blockedAt\}', \$\{blockedAt\}/);
assert.match(
  read("src/components/control/control-panel-sections.tsx"),
  /<PendingApprovals \/>/,
  "Home (phone)",
);
assert.match(
  read("src/components/terminal/SessionComposer.tsx"),
  /<PendingApprovals tab=\{tab\} \/>/,
  "the open session",
);

// ── MCP: listed with chat, answered with act ─────────────────────────────────
assert.equal(MCP_TOOL_SCOPES.loki_approvals_list, MCP_SCOPE.chat);
assert.equal(MCP_TOOL_SCOPES.loki_approve, MCP_SCOPE.act);

async function main() {
  const pending: PendingApproval = {
    id,
    runId: RUN,
    tab: "orangecat",
    project: "orangecat",
    question: "Do you want to proceed?",
    kind: "tool",
    choices: ["allow_once", "allow_always", "deny"],
    since: "2026-11-12T04:59:00Z",
    headline: "Waiting for your approval: Do you want to proceed? (waiting for 6 minutes)",
  };
  const answered: Array<{ userId: string; id: string; decision: string }> = [];
  const services = {
    sessionApprovals: async (userId: string) => (userId === "owner" ? [pending] : []),
    answerSessionApproval: async (userId: string, approvalIdArg: string, decision: string) => {
      answered.push({ userId, id: approvalIdArg, decision });
      return userId === "owner"
        ? { ok: true as const, approval: pending, decision: decision as "deny" }
        : { ok: false as const, status: 404 as const, error: "No such approval." };
    },
  } as unknown as McpServices;
  const caller = (userId: string, scopes: string[]) =>
    ({ userId, scopes: new Set(scopes), via: "agent-token", clientId: "test" }) as never;

  const listed = await callTool(
    "loki_approvals_list",
    {},
    caller("owner", [MCP_SCOPE.chat]),
    services,
  );
  assert.match(JSON.stringify(listed), /Waiting for your approval: Do you want to proceed\?/);
  const none = await callTool(
    "loki_approvals_list",
    {},
    caller("stranger", [MCP_SCOPE.chat]),
    services,
  );
  assert.match(JSON.stringify(none), /No agent session is waiting/, "another account sees none");

  const noScope = await callTool(
    "loki_approve",
    { id, decision: "deny" },
    caller("owner", [MCP_SCOPE.chat]),
    services,
  );
  assert.match(JSON.stringify(noScope), /needs the loki\.act scope/, "answering needs act");
  assert.equal(answered.length, 0);

  const ok = await callTool(
    "loki_approve",
    { id, decision: "deny" },
    caller("owner", [MCP_SCOPE.act]),
    services,
  );
  assert.match(JSON.stringify(ok), /Answered \\"Deny\\" to orangecat/);
  const outOfScope = await callTool(
    "loki_approve",
    { id, decision: "allow_once" },
    caller("stranger", [MCP_SCOPE.act]),
    services,
  );
  assert.match(JSON.stringify(outOfScope), /No such approval/, "another account cannot answer");
  const bad = await callTool(
    "loki_approve",
    { id, decision: "yes please" },
    caller("owner", [MCP_SCOPE.act]),
    services,
  );
  assert.equal(answered.length, 2, "a made-up decision never reaches the service");
  assert.ok(bad, "a bad decision is answered with an error");
  console.log("approvals ok");
}
void main();
