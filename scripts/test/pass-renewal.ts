// Renewing a Bitcoin pass early keeps the days left (lib/billing/pass-renewal).
import assert from "node:assert/strict";
import { renewedPassExpiry } from "../../src/lib/billing/pass-renewal";

const DAY = 24 * 60 * 60 * 1000;
const paidAt = new Date("2026-11-12T12:00:00Z");
const at = (days: number) => new Date(paidAt.getTime() + days * DAY).toISOString();
const renew = (current: { plan: string | null; planExpiresAt: Date | null } | null, plan = "pro") =>
  renewedPassExpiry({ current, plan, periodDays: 30, paidAt }).toISOString();

// No pass yet: thirty days from payment.
assert.equal(renew(null), at(30));
assert.equal(renew({ plan: "free", planExpiresAt: null }), at(30));
// Same plan with ten days left: the thirty are added to the end.
assert.equal(renew({ plan: "pro", planExpiresAt: new Date(at(10)) }), at(40));
// Lapsed: starts from payment.
assert.equal(renew({ plan: "pro", planExpiresAt: new Date(at(-5)) }), at(30));
// A different plan does not stack onto the old one.
assert.equal(renew({ plan: "starter", planExpiresAt: new Date(at(10)) }, "pro"), at(30));
console.log("✓ pass-renewal");
