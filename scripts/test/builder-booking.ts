/**
 * Builders through the studio (Track 3 of docs/master-plan-2026-10.md): the
 * assigned partner is a seat on one project, their fee is a service in their
 * own name, and the brief is paid only by OrangeCat's word. Pure pieces plus
 * the wiring, read from the source. Run: npx tsx scripts/test/builder-booking.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { FEE_CURRENCIES, StudioGuestAction } from "../../src/config/studio";
import { feeServicePayload, feeView } from "../../src/lib/studio/fee";
import { seatChange } from "../../src/lib/studio/seat-change";
import { studioView } from "../../src/lib/studio/projection";
import type { StudioRequest } from "../../src/db/schema/studio-requests";

const read = (p: string) => readFileSync(p, "utf8");

// A fee rides a delivery, in a currency OrangeCat lists services in.
const delivery = {
  mutationId: randomUUID(),
  action: "deliver_assignment",
  requestId: randomUUID(),
  expectedVersion: 0,
  previewUrl: "https://preview.example.com",
  scope: "A booking page with a calendar and payment.",
  summary: "Built the page; checked on a phone at 390px.",
};
assert.equal(StudioGuestAction.safeParse(delivery).success, true, "a delivery without a fee");
const withFee = StudioGuestAction.parse({ ...delivery, fee: { amount: 800, currency: "CHF" } });
assert.ok(withFee.action === "deliver_assignment" && withFee.fee?.amount === 800);
assert.deepEqual([...FEE_CURRENCIES], ["CHF", "BTC", "EUR", "USD"]);
for (const fee of [
  { amount: 0, currency: "CHF" },
  { amount: -5, currency: "CHF" },
  { amount: 10, currency: "GBP" },
  { amount: 10, currency: "CHF", note: "x" },
])
  assert.equal(
    StudioGuestAction.safeParse({ ...delivery, fee }).success,
    false,
    JSON.stringify(fee),
  );

// The listing is live at once, in the partner's name, off their profile.
const payload = feeServicePayload({
  fee: { amount: 0.0123, currency: "BTC" },
  partnerName: "Ada",
  website: "https://murphys-bar.orangecat.ch/",
  changes: "Make booking easier.",
});
assert.equal(payload.title, "Ada: murphys-bar.orangecat.ch");
assert.equal(payload.status, "active");
assert.equal(payload.show_on_profile, false);
assert.equal(payload.fixed_price, 0.0123);
assert.equal(payload.currency, "BTC");
assert.equal(payload.category, "human_task");
assert.match(payload.description, /paid to Ada/);

// What the three people read: nothing, then the fee, then the link, then paid.
const bare = {
  feeAmount: null,
  feeCurrency: null,
  feeServiceId: null,
  feeUrl: null,
  feePaidAt: null,
};
assert.equal(feeView(bare), null);
assert.deepEqual(feeView({ ...bare, feeAmount: 800, feeCurrency: "CHF" }), {
  amount: 800,
  currency: "CHF",
  url: null,
  listed: false,
  paidAt: null,
});
const paidAt = new Date("2026-10-20T12:00:00Z");
const listed = {
  ...bare,
  feeAmount: 800,
  feeCurrency: "CHF" as const,
  feeServiceId: "svc1",
  feeUrl: "https://orangecat.ch/services/svc1",
  feePaidAt: paidAt,
};
assert.deepEqual(feeView(listed), {
  amount: 800,
  currency: "CHF",
  url: "https://orangecat.ch/services/svc1",
  listed: true,
  paidAt: paidAt.toISOString(),
});
// The portal projection carries it, and only it — no ids leak.
const row = {
  ...listed,
  id: randomUUID(),
  kind: "website",
  target: "partner",
  website: "https://murphys-bar.orangecat.ch/",
  changes: "Make booking easier.",
  status: "accepted",
  createdAt: paidAt,
  updatedAt: paidAt,
  previewUrl: "https://preview.example.com",
  deliveryVersion: 1,
  approvedVersion: 1,
  scope: "s",
  deliverySummary: "d",
  offerSnapshot: null,
  builderUserId: randomUUID(),
} as unknown as StudioRequest;
const view = studioView(row, []);
assert.equal(view.fee?.listed, true);
assert.equal("builderUserId" in view, false, "the seat holder's id stays off the guest view");

// The seat follows the two facts it rests on.
const p1 = randomUUID();
const p2 = randomUUID();
const u1 = randomUUID();
const u2 = randomUUID();
const none = { projectId: null, builderUserId: null };
assert.equal(seatChange(none, none), null);
assert.equal(seatChange(none, { projectId: p1, builderUserId: null }), null, "no account, no seat");
assert.deepEqual(seatChange(none, { projectId: p1, builderUserId: u1 }), {
  revoke: null,
  grant: { projectId: p1, userId: u1 },
});
assert.equal(
  seatChange({ projectId: p1, builderUserId: u1 }, { projectId: p1, builderUserId: u1 }),
  null,
  "the same seat again changes nothing",
);
assert.deepEqual(
  seatChange({ projectId: p1, builderUserId: u1 }, { projectId: p1, builderUserId: u2 }),
  {
    revoke: { projectId: p1, userId: u1 },
    grant: { projectId: p1, userId: u2 },
  },
);
assert.deepEqual(
  seatChange({ projectId: p1, builderUserId: u1 }, { projectId: p2, builderUserId: u1 }),
  {
    revoke: { projectId: p1, userId: u1 },
    grant: { projectId: p2, userId: u1 },
  },
);
assert.deepEqual(seatChange({ projectId: p1, builderUserId: u1 }, none), {
  revoke: { projectId: p1, userId: u1 },
  grant: null,
});

// The wiring: the seat is an editor and a private builder; the fee is listed
// with the BUILDER's token, never the studio's key; paid comes from OrangeCat.
const seat = read("src/lib/studio/seat.ts");
assert.match(seat, /upsertProjectMember\([^)]*"editor"\)/);
assert.match(seat, /setPrivateBuilder\([^)]*true\)/);
const queries = read("src/db/queries/studio-requests.ts");
assert.match(queries, /case "assign_partner"[\s\S]*patch\.builderUserId = builder\?\.id \?\? null/);
assert.match(queries, /case "link_project"[\s\S]*seat = seatChange\(/);
assert.match(queries, /case "revoke_access"[\s\S]*seat = seatChange\(/);
assert.match(queries, /if \(saved\.seat\) await applyBuilderSeat\(saved\.seat\)/);
assert.match(queries, /export async function markStudioFeePaid/);
const listing = read("src/lib/integrations/orangecat-fee-service.ts");
assert.match(listing, /getOrangeCatLink\(builderUserId\)/);
assert.doesNotMatch(listing, /ORANGECAT_API_KEY|getOrangeCatClient/);
assert.match(listing, /\/api\/v1\/services/);
assert.match(
  read("src/auth.ts"),
  /service\.write/,
  "the sign-in asks for the scope the listing needs",
);
const events = read("src/app/api/orangecat/events/route.ts");
assert.match(
  events,
  /ev\.entityType === "service" \? await markStudioFeePaid\(ev\.entityId, ev\.externalId\)/,
);
assert.match(
  read("src/app/api/studio-portal/[id]/route.ts"),
  /listAssignmentFee\(saved\.feeFor, saved\.row\)/,
);
// Nothing in the fee path spends the owner's engine or money: no allowance, no studio key.
assert.doesNotMatch(read("src/lib/studio/fee-listing.ts"), /ORANGECAT_API_KEY|monthly|allowance/);

console.log(
  "✓ builder booking: a seat on one project, a fee in the builder's name, paid by OrangeCat's word",
);
