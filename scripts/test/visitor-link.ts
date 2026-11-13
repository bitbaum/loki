// Public links follow who is reading (src/lib/visitor-link.ts), and the
// browser chrome follows the theme actually rendered (src/lib/palette.ts).
// Run: npx tsx scripts/test/visitor-link.ts
import assert from "node:assert/strict";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import { visitorLink } from "@/lib/visitor-link";
import { PALETTE, themeColorFor } from "@/lib/palette";

const signUp = { label: "Create an account", href: ROUTES.SIGN_UP, id: "x" };
const signIn = { label: "Sign in", href: ROUTES.SIGN_IN };
const other = { label: "See how changes work", href: "/how-it-works#change" };

// Signed out: nothing changes.
assert.deepEqual(visitorLink(signUp, false), signUp);
assert.deepEqual(visitorLink(signIn, false), signIn);

// Signed in: a link into an account becomes the way into Loki, other fields kept.
assert.deepEqual(visitorLink(signUp, true), {
  label: `Open ${APP_NAME}`,
  href: ROUTES.APP_HOME,
  id: "x",
});
assert.equal(visitorLink(signIn, true).href, ROUTES.APP_HOME);

// Any other link is left alone.
assert.deepEqual(visitorLink(other, true), other);

// Browser chrome: dark unless light is what is rendered.
assert.equal(themeColorFor(undefined), PALETTE.dark.surfacePage);
assert.equal(themeColorFor("dark"), PALETTE.dark.surfacePage);
assert.equal(themeColorFor("light"), PALETTE.light.surfacePage);

console.log("✓ public links follow the reader; chrome follows the theme");
