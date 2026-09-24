/**
 * Invitations into one project: the rules that decide who gets into someone
 * else's project. Each check is a way the grant could go to the wrong person.
 */

import assert from "node:assert/strict";
import {
  evaluateInviteAcceptance,
  hashInviteToken,
  inviteExpiry,
  maskEmail,
  newInviteToken,
  normalizeInviteEmail,
  PROJECT_INVITE_TTL_DAYS,
  projectInvitePath,
  type InviteState,
} from "@/lib/project-invites";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const NOW = new Date("2026-09-24T12:00:00Z");
const live = (over: Partial<InviteState> = {}): InviteState => ({
  email: "georgbotsmann@gmail.com",
  expiresAt: new Date(NOW.getTime() + 60_000),
  acceptedAt: null,
  revokedAt: null,
  ...over,
});

check("the invited account may accept", () => {
  assert.deepEqual(evaluateInviteAcceptance(live(), "georgbotsmann@gmail.com", NOW), { ok: true });
});

check("email matching ignores case and surrounding space", () => {
  const v = evaluateInviteAcceptance(live(), "  GeorgBotsmann@Gmail.com ", NOW);
  assert.equal(v.ok, true);
});

// The token is a bearer secret that gets forwarded. It must not be enough.
check("a forwarded link opens nothing for a different account", () => {
  const v = evaluateInviteAcceptance(live(), "someone.else@example.com", NOW);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, "wrong-account");
});

check("the wrong-account message never shows the full invited address", () => {
  const v = evaluateInviteAcceptance(live(), "someone.else@example.com", NOW);
  assert.ok(
    !v.ok && !v.message.includes("georgbotsmann@"),
    "full address leaked to the link holder",
  );
  assert.ok(!v.ok && v.message.includes("ge•••@gmail.com"));
});

check("an account with no email cannot be matched, so cannot accept", () => {
  for (const e of [null, undefined, "", "   "]) {
    const v = evaluateInviteAcceptance(live(), e, NOW);
    assert.equal(!v.ok && v.reason, "no-email", `accepted with email=${JSON.stringify(e)}`);
  }
});

check("a withdrawn invite grants nothing, even to the right person", () => {
  const v = evaluateInviteAcceptance(live({ revokedAt: NOW }), "georgbotsmann@gmail.com", NOW);
  assert.equal(!v.ok && v.reason, "revoked");
});

check("an invite grants once", () => {
  const v = evaluateInviteAcceptance(live({ acceptedAt: NOW }), "georgbotsmann@gmail.com", NOW);
  assert.equal(!v.ok && v.reason, "accepted");
});

check("an expired invite grants nothing — expiry is the boundary, not after it", () => {
  const atExpiry = evaluateInviteAcceptance(
    live({ expiresAt: NOW }),
    "georgbotsmann@gmail.com",
    NOW,
  );
  assert.equal(!atExpiry.ok && atExpiry.reason, "expired");
});

// Why an invite fails is the state of the invite first, identity second: a
// revoked invite should not tell a stranger to "sign in with that account".
check("a dead invite reports its state before judging who you are", () => {
  const v = evaluateInviteAcceptance(live({ revokedAt: NOW }), "someone.else@example.com", NOW);
  assert.equal(!v.ok && v.reason, "revoked");
});

check("the database keeps a hash, never the token", () => {
  const token = newInviteToken();
  const hash = hashInviteToken(token);
  assert.notEqual(hash, token);
  assert.ok(!hash.includes(token));
  assert.equal(hash, hashInviteToken(token), "hashing must be deterministic to look invites up");
  assert.match(hash, /^[0-9a-f]{64}$/);
});

check("tokens are long, URL-safe and not repeated", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = newInviteToken();
    assert.ok(t.length >= 43, "32 random bytes");
    assert.match(t, /^[A-Za-z0-9_-]+$/, "URL-safe");
    assert.ok(!seen.has(t));
    seen.add(t);
  }
});

check("the link carries the raw token under /invite/project/", () => {
  assert.equal(projectInvitePath("abc"), "/invite/project/abc");
});

check("an invite lasts the stated number of days", () => {
  const days = (inviteExpiry(NOW).getTime() - NOW.getTime()) / 86_400_000;
  assert.equal(days, PROJECT_INVITE_TTL_DAYS);
});

check("stored emails are normalised the same way they are compared", () => {
  assert.equal(normalizeInviteEmail("  A@B.CH "), "a@b.ch");
  assert.equal(maskEmail("GeorgBotsmann@Gmail.com"), "ge•••@gmail.com");
});

console.log(`\nproject-invites: ${passed} checks passed`);
