// Pins who "forgot password" may email. An account only OrangeCat created
// must get no reset link (its address is unverified); Loki's own rule — a
// GitHub/Google account without a password may set one — must survive.
import assert from "node:assert/strict";
import { lokiMayReceivePasswordReset as may } from "../../src/lib/auth/reset-eligibility";

const ACTOR = "0a4a0e2e-1111-4222-8333-444455556666";
const base = { email: "a@x.ch", passwordHash: null, orangecatActorId: null };

assert.equal(may({ ...base, orangecatActorId: ACTOR }, ["orangecat"]), false, "OrangeCat-only");
assert.equal(may(base, ["orangecat"]), false, "OrangeCat-only, linked before the actor column");
assert.equal(may(base, ["github"]), true, "GitHub account may set a password (Loki's rule)");
assert.equal(
  may({ ...base, orangecatActorId: ACTOR }, ["orangecat", "google"]),
  true,
  "also Google",
);
assert.equal(
  may({ ...base, passwordHash: "h", orangecatActorId: ACTOR }, ["orangecat"]),
  true,
  "own password",
);
assert.equal(may({ ...base, email: null }, []), false, "no address");

console.log("reset-eligibility: ok");
