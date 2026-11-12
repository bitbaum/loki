/**
 * An agent's `ck_` token reads what the person's browser reads, and nothing
 * more is opened to it than reading.
 *
 * QA's Viewer seat sent its token on every request (12 Nov) and got 401 from
 * /api/user-projects, /api/me and /api/projects/:id, and nothing from the
 * transcript stream: those GETs asked for a browser session only, although
 * the middleware had already let the Bearer through. Each now resolves the
 * caller with getApiUserId / getApiActor, which takes the cookie first and
 * then the token, and answers for that one user: a token is a user's own, so
 * its projects are that user's (owned, or shared to it through a membership,
 * with the membership's role — scripts/test/token-scope.ts proves that part
 * against a real database).
 *
 * Deny side: what changes the account or a project stays a signed-in
 * person's. A token cannot delete the account, rename it, change a password,
 * unlink a sign-in, or create, edit or delete a project through these routes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mayPeekTab } from "../../src/lib/peek-access";
import { shellTabFromHex } from "../../src/lib/shell-session";

const read = (p: string) => fs.readFileSync(p, "utf8");

/** The body of one exported handler, up to the next export. */
function handler(file: string, method: string): string {
  const src = read(file);
  const start = src.indexOf(`export async function ${method}(`);
  assert.ok(start >= 0, `${file}: no ${method} handler`);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

const TOKEN_READS: Array<[string, string]> = [
  ["src/app/api/user-projects/route.ts", "GET"],
  ["src/app/api/user-projects/[id]/route.ts", "GET"],
  ["src/app/api/me/route.ts", "GET"],
  ["src/app/api/projects/[id]/route.ts", "GET"],
  ["src/app/api/control/transcript-stream/route.ts", "GET"],
  // Already token-readable before this change; listed so they stay so.
  ["src/app/api/sessions/route.ts", "GET"],
  ["src/app/api/conversations/route.ts", "GET"],
];
for (const [file, method] of TOKEN_READS) {
  const body = handler(file, method);
  assert.match(body, /getApiUserId\(\)|getApiActor\(\)/, `${file} ${method}: session or token`);
  assert.doesNotMatch(body, /getSessionUserId\(\)/, `${file} ${method}: not session-only`);
}

const SESSION_ONLY: Array<[string, string]> = [
  ["src/app/api/me/route.ts", "PATCH"],
  ["src/app/api/me/route.ts", "DELETE"],
  ["src/app/api/me/password/route.ts", "PATCH"],
  ["src/app/api/me/password/route.ts", "POST"],
  ["src/app/api/me/connected-accounts/[provider]/route.ts", "DELETE"],
  ["src/app/api/user-projects/route.ts", "POST"],
  ["src/app/api/user-projects/[id]/route.ts", "PATCH"],
  ["src/app/api/user-projects/[id]/route.ts", "DELETE"],
  ["src/app/api/projects/[id]/route.ts", "PATCH"],
  ["src/app/api/projects/[id]/route.ts", "DELETE"],
];
for (const [file, method] of SESSION_ONLY) {
  const body = handler(file, method);
  assert.match(body, /getSessionUserId\(\)/, `${file} ${method}: a signed-in person only`);
  assert.doesNotMatch(body, /getApiUserId\(\)|getApiActor\(\)/, `${file} ${method}: no token`);
}

// The transcript stream: an agent conversation is the token's to follow, a
// plain shell is not, and the stream is keyed by the caller's own user id.
const stream = handler("src/app/api/control/transcript-stream/route.ts", "GET");
assert.match(stream, /mayPeekTab\(tab, actor\.via\)/, "shells stay out of a token's reach");
assert.match(stream, /transcriptChannel\(userId, tab/, "a token follows its own user's tabs");
assert.equal(mayPeekTab("qa-agent-walk", "token"), true);
assert.equal(mayPeekTab(shellTabFromHex("0a1b2c3d"), "token"), false);

// The project read answers through the membership-aware resolver, so a Viewer
// reads its projects read-only and a stranger's not at all.
assert.match(
  handler("src/app/api/projects/[id]/route.ts", "GET"),
  /resolveProjectDetailWithOrgFallback\(userId, id\)/,
);
// /api/user-projects stays the caller's own rows.
assert.match(
  handler("src/app/api/user-projects/route.ts", "GET"),
  /ensureUserProjectEntityLinks\(userId\)/,
);
assert.match(
  handler("src/app/api/user-projects/[id]/route.ts", "GET"),
  /getUserProject\(idOrResp, userId\)/,
);

console.log("token-session-routes ok");
