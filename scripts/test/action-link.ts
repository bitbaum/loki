// Pins one-tap approval tokens — the thing standing between a Telegram button
// and someone else's approval queue.
//
// Why it earns a test: this token is a bearer authorisation that travels
// outside the app and needs no session on the other end. Everything that makes
// that acceptable is in the verify function — scope to one action, scope to one
// verb, an expiry, and a signature that actually covers all of it. Each of those
// is a line of code that a refactor could quietly drop while every happy-path
// test kept passing, because a token that verifies too easily still verifies.
//
// So the assertions are mostly forgeries. The one that matters most is the
// tampering pair: a token whose actionId or verb was edited must fail, which is
// the difference between "signed" and "signed over the right bytes".
process.env.AUTH_SECRET ||= "test-secret-for-action-links";

import {
  ACTION_LINK_VERBS,
  actionEditUrl,
  actionLinkUrl,
  createActionLinkToken,
  verifyActionLinkToken,
  LINK_TTL_MS,
} from "@/lib/actions/action-link";

const NOW = Date.parse("2026-09-17T10:00:00Z");
const ACTION = "11111111-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_ACTION = "99999999-8888-7777-6666-555555555555";

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

const mint = (verb: "approve" | "reject" = "approve", actionId = ACTION) =>
  createActionLinkToken({ actionId, userId: USER, verb }, NOW);

// ── Round trip ──────────────────────────────────────────────────────────────
const approveToken = mint("approve");
const claim = verifyActionLinkToken(approveToken, NOW);
check("a fresh token verifies", claim !== null);
check("it carries the action id back", claim?.actionId === ACTION);
check("it carries the user id back", claim?.userId === USER);
check("it carries the verb back", claim?.verb === "approve");
check("reject round-trips too", verifyActionLinkToken(mint("reject"), NOW)?.verb === "reject");
check("only approve and reject exist as verbs", ACTION_LINK_VERBS.length === 2);

// ── Expiry ──────────────────────────────────────────────────────────────────
check(
  "live one millisecond before expiry",
  verifyActionLinkToken(approveToken, NOW + LINK_TTL_MS - 1) !== null,
);
check(
  "dead one millisecond after expiry",
  verifyActionLinkToken(approveToken, NOW + LINK_TTL_MS + 1) === null,
);

// ── Forgery and tampering — the reason this file exists ─────────────────────
check("garbage is refused", verifyActionLinkToken("nonsense", NOW) === null);
check("empty string is refused", verifyActionLinkToken("", NOW) === null);
check(
  "an unsigned but well-shaped token is refused",
  verifyActionLinkToken(`${ACTION}.${USER}.approve.${NOW + LINK_TTL_MS}.deadbeef`, NOW) === null,
);
check(
  "a token with no signature segment is refused",
  verifyActionLinkToken(`${ACTION}.${USER}.approve.${NOW + LINK_TTL_MS}`, NOW) === null,
);

// Swap the action id but keep the valid signature: the classic "approve a
// DIFFERENT row with a link you were legitimately given" attack.
const parts = approveToken.split(".");
check(
  "swapping the action id invalidates the token",
  verifyActionLinkToken([OTHER_ACTION, parts[1], parts[2], parts[3], parts[4]].join("."), NOW) ===
    null,
);
check(
  "swapping the user id invalidates the token",
  verifyActionLinkToken([parts[0], OTHER_ACTION, parts[2], parts[3], parts[4]].join("."), NOW) ===
    null,
);
// Verb escalation: a reject link must never be editable into an approve link.
const rejectParts = mint("reject").split(".");
check(
  "editing reject → approve invalidates the token",
  verifyActionLinkToken(
    [rejectParts[0], rejectParts[1], "approve", rejectParts[3], rejectParts[4]].join("."),
    NOW,
  ) === null,
);
check(
  "extending the expiry invalidates the token",
  verifyActionLinkToken(
    [parts[0], parts[1], parts[2], String(NOW + LINK_TTL_MS * 10), parts[4]].join("."),
    NOW,
  ) === null,
);
check(
  "an unknown verb is refused even if it were signed",
  verifyActionLinkToken(`${ACTION}.${USER}.delete.${NOW + LINK_TTL_MS}.x`, NOW) === null,
);

// Two different actions must not produce the same token — a signature that
// ignored its payload would still pass every test above but this one.
check("different actions produce different tokens", mint("approve", OTHER_ACTION) !== approveToken);
check("different verbs produce different tokens", mint("reject") !== approveToken);

// ── URLs are absolute (they are read inside Telegram) ───────────────────────
check(
  "the decision URL is absolute and points at /a/",
  /^https:\/\/[^/]+\/a\/.+/.test(
    actionLinkUrl({ actionId: ACTION, userId: USER, verb: "approve" }),
  ),
);
check(
  "the edit URL is absolute and focuses the row",
  actionEditUrl(ACTION).startsWith("https://") && actionEditUrl(ACTION).includes(`focus=${ACTION}`),
);

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
