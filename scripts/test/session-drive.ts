/**
 * A seat drives the one project session its owner lets it drive, and nothing
 * else (src/lib/session-drive.ts).
 *
 * QA's Viewer seat on qa-agent-walk had no session to drive: every control
 * route reads the caller's own sessions, and the seat owns none. The owner
 * now grants it per project (project_memberships.drives_session). This pins
 * that the grant reaches that project's own tab and can never be bent into
 * the orangecat or loki tabs, a lane, or a shell. The database half is
 * scripts/test/session-drive-db.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { decideDriveTarget, type DriveGrant } from "../../src/lib/session-drive";
import { shellTabFromHex } from "../../src/lib/shell-session";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const SEAT = "00000000-0000-4000-8000-00000000000b";
const grants: DriveGrant[] = [{ ownerId: OWNER, projectName: "qa-agent-walk" }];
const decide = (tab: string, callerOwnsTab = false, g = grants) =>
  decideDriveTarget({ callerId: SEAT, tab, callerOwnsTab, grants: g });

// ── allow ──────────────────────────────────────────────────────────────────
assert.deepEqual(decide("qa-agent-walk"), {
  kind: "granted",
  ownerId: OWNER,
  tab: "qa-agent-walk",
  drivenBy: SEAT,
});
assert.deepEqual(
  decide("QA-Agent-Walk "),
  { kind: "granted", ownerId: OWNER, tab: "qa-agent-walk", drivenBy: SEAT },
  "the owner's spelling of the tab, never the caller's",
);

// ── deny: everything else stays in the seat's own (empty) name space ────────
for (const other of [
  "orangecat",
  "loki",
  "qa-agent-walk~1a2b3c4d", // a lane is not the project's own tab
  "qa-agent-walk2",
  shellTabFromHex("0a1b2c3d"),
]) {
  const t = decide(other);
  assert.equal(t.kind, "own", `${other} is not granted`);
  assert.equal(t.ownerId, SEAT, `${other} never reaches the owner's sessions`);
}
assert.equal(decide("qa-agent-walk", false, []).kind, "own", "no grant, no reach");
assert.equal(
  decide("qa-agent-walk", true).ownerId,
  SEAT,
  "a tab the caller owns is the caller's own, grant or not",
);
const shell = shellTabFromHex("0a1b2c3d");
assert.equal(
  decide(shell, false, [{ ownerId: OWNER, projectName: shell }]).kind,
  "own",
  "a shell is never granted, whatever it is called",
);

// ── the wiring ─────────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");
const inject = read("src/app/api/control/tab-inject/route.ts");
assert.match(inject, /const target = await resolveDriveTarget\(callerId, dataOrResp\.tab\);/);
assert.match(inject, /const userId = target\.ownerId;\n\s*const tab = target\.tab;/);
assert.match(inject, /drivenBy: opts\.drivenBy/, "the run names the member who drove it");
assert.doesNotMatch(
  inject,
  /dataOrResp\.tab(?!\))/,
  "nothing reads the caller's spelling after resolving",
);

const ask = read("src/app/api/control/peek-tab/route.ts");
assert.match(ask, /userId: target\.ownerId/);
const answer = read("src/app/api/control/peek-tab/[id]/route.ts");
assert.match(
  answer,
  /cmd\.userId !== target\.ownerId/,
  "a capture is read by its asker's grant, re-checked",
);
assert.match(answer, /target\.kind === "granted" && target\.tab !== tab/);
assert.match(
  read("src/app/api/sessions/route.ts"),
  /target\?\.kind === "granted" \? target\.ownerId : userId/,
);

// The grant is the owner's to give, signed in: not a token's, not a member's.
const members = read("src/app/api/projects/[id]/members/route.ts");
assert.match(members, /export async function PATCH/);
assert.match(members, /async function ownerAccess[\s\S]*?getSessionUserId\(\)/);
assert.match(
  members.slice(members.indexOf("export async function PATCH")),
  /canManageMembers/,
  "only the owner grants",
);
// Raw keystrokes stay out of a grant: approving a permission prompt is the owner's.
assert.doesNotMatch(read("src/app/api/control/tab-inject-raw/route.ts"), /resolveDriveTarget/);

console.log("session-drive ok");
