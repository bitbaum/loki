// The "notifications on this phone" card: every state the browser can be in
// says what is true and offers a way forward — a state with neither is the dead
// end this card exists to remove (production held zero subscribed devices
// because no screen ever offered the choice).
import assert from "node:assert/strict";
import { pushCardView, type PushStatus } from "../../src/lib/push-card";

const STATUSES: PushStatus[] = [
  "unsupported",
  "denied",
  "default",
  "granted",
  "subscribed",
  "registering",
  "error",
];
const base = { keyMissing: false, isIos: false, error: null };

// Every state has words; every state a person can act in has a button.
for (const status of STATUSES) {
  const v = pushCardView({ ...base, status });
  assert.ok(v.headline.length > 0 && v.body.length > 0, `${status}: says something`);
  if (status === "default" || status === "granted" || status === "error") {
    assert.equal(v.primary?.action, "subscribe", `${status}: the way forward is Turn on`);
  }
}

// Subscribed: proof and an exit, and it reads as working.
const on = pushCardView({ ...base, status: "subscribed" });
assert.equal(on.tone, "on");
assert.equal(on.primary?.action, "test", "a working channel can be tested");
assert.equal(on.secondary?.action, "unsubscribe", "and turned off");

// Blocked and unsupported cannot be fixed by a button here — they say what to do instead.
const denied = pushCardView({ ...base, status: "denied" });
assert.equal(denied.primary, null);
assert.match(denied.body, /site settings/i, "denied names where to change it");

// iPhone Safari: the one fix is Add to Home Screen, and the card says so.
const ios = pushCardView({ ...base, status: "unsupported", isIos: true });
assert.match(ios.body, /Home Screen/);
const other = pushCardView({ ...base, status: "unsupported", isIos: false });
assert.doesNotMatch(other.body, /Home Screen/, "no iPhone advice for other browsers");

// A server with no key cannot subscribe anyone, whatever the browser says.
const noKey = pushCardView({ ...base, status: "default", keyMissing: true });
assert.equal(noKey.primary, null);
assert.match(noKey.headline, /aren't set up/i);

// An error names itself but still offers a retry.
const err = pushCardView({ ...base, status: "error", error: "boom" });
assert.match(err.body, /boom/);
assert.equal(err.primary?.action, "subscribe");

console.log("push-card: ok");
