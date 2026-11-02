/**
 * Static accessibility checks for the auth form primitives.
 * Run: npm run test:auth-a11y
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const authShell = fs.readFileSync("src/components/auth/AuthShell.tsx", "utf8");
const signIn = fs.readFileSync("src/components/auth/SignInForm.tsx", "utf8");
const onboarding = fs.readFileSync("src/app/onboarding/page.tsx", "utf8");

assert.match(authShell, /<label className="ui-auth-label" htmlFor=\{fieldId\}>/);
assert.match(authShell, /only\.type === AuthInput/);
assert.match(authShell, /cloneElement/);
assert.match(authShell, /id=\{id\}/);

assert.match(signIn, /<AuthInput\s+id="email"/);
assert.match(signIn, /<AuthField label=\{L.password\} htmlFor="password">/);
assert.match(signIn, /<AuthInput\s+id="owner-password"/);

assert.match(onboarding, /<AuthField label="Username" htmlFor="onboarding-username">/);
assert.match(onboarding, /id="onboarding-username"/);

console.log("✓ auth accessibility checks passed");
