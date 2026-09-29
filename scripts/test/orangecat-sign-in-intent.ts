// Pins how Loki hands a person to OrangeCat by intent (ADR-0009 there, D7).
//
// "Create an account" on Loki's sign-up page must open OrangeCat's own
// create-account screen: that is OIDC Prompt Create, `prompt=create`, which
// OrangeCat advertises in its discovery document. Sign-in must NOT send it —
// a returning person would land on a sign-up screen. The label follows the
// intent so the button says what will happen. Both are one function each so
// the sign-up and sign-in buttons cannot drift apart.
import assert from "node:assert/strict";
import {
  orangecatAuthorizationParams,
  orangecatButtonLabel,
} from "../../src/lib/auth/orangecat-sign-in";

assert.deepEqual(orangecatAuthorizationParams("sign-up"), { prompt: "create" });
assert.equal(orangecatAuthorizationParams("sign-in"), undefined);
assert.equal(orangecatButtonLabel("sign-up"), "Create an account with OrangeCat");
assert.equal(orangecatButtonLabel("sign-in"), "Continue with OrangeCat");

console.log("orangecat-sign-in-intent: ok");
