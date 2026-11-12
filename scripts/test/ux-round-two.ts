/**
 * Pins for defects found by the signed-in audit of 2026-11-12, each of which
 * passed the type checker, lint and every test while a person could not use
 * the screen. Source pins where the fact is one line; behaviour where it is a
 * function. The browser measurements are in docs/development/ux-pass-2026-11.md.
 *
 *   npx tsx scripts/test/ux-round-two.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signInSucceeded } from "../../src/lib/auth/sign-in-result";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// 1. A refused sign-in is refused. Auth.js answers 200 with the reason in `error`.
assert.equal(signInSucceeded({ ok: true, error: null }), true);
assert.equal(signInSucceeded({ ok: true }), true);
assert.equal(signInSucceeded({ ok: true, error: "CredentialsSignin" }), false);
assert.equal(signInSucceeded({ ok: false }), false);
assert.equal(signInSucceeded(undefined), false);
for (const form of ["src/components/auth/SignInForm.tsx", "src/components/auth/SignUpForm.tsx"]) {
  const src = read(form);
  assert.doesNotMatch(src, /if \((res|result)\?\.ok\)/, `${form} tests ok alone`);
  assert.match(src, /signInSucceeded\(/);
}

// 2. A sent message's width cap is on the stack, as a share of the row. On the
// bubble it was a share of the stack, which shrinks to its content.
const css = read("src/app/globals.css");
const stack = css.slice(css.indexOf(".ui-loki-turn-user-stack {"));
assert.match(stack.slice(0, 400), /max-width: 90%/);
assert.match(css, /\.ui-loki-turn-user-stack > \.ui-loki-bubble \{\s*max-width: 100%;/);

// 3. Onboarding: the confirmation row is for a picked repository, not for a
// name that is not empty (the field vanished after one keystroke).
const onboarding = read("src/app/onboarding/page.tsx");
assert.match(onboarding, /\{repoPicked && !showManual \? \(/);
assert.doesNotMatch(onboarding, /\{projectName && !showManual \? \(/);

// 4. The sidebar's width is known to the server, so nothing slides on load.
const layout = read("src/app/(app)/layout.tsx");
assert.match(layout, /SIDEBAR_COLLAPSE_COOKIE/);
assert.match(layout, /initialSidebarCollapsed=/);
const shell = read("src/components/shell/AppShell.tsx");
assert.match(shell, /useState\(initialSidebarCollapsed\)/);
assert.match(shell, /document\.cookie = `\$\{SIDEBAR_COLLAPSE_COOKIE\}=/);

// 5. The app has a skip link, and it has somewhere to land.
assert.match(shell, /href="#content" className="ui-skip-link"/);
assert.match(shell, /<main id="content" tabIndex=\{-1\}/);

// 6. Revoking a token reads the server's answer and asks first.
const tokens = read("src/components/settings/AgentTokenSettings.tsx");
assert.match(tokens, /if \(!res\.ok\) \{\s*setRevokeError\(/);
assert.match(tokens, /<DetailSheet\s+title=\{`Revoke \$\{revoking\.label\}\?`\}/);
assert.doesNotMatch(tokens, /onClick=\{\(\) => remove\(t\.id\)\}/);

// 7. The desktop notifications panel is a dialog on <body>, not inside the bar.
const bell = read("src/components/shell/NotificationsPill.tsx");
assert.match(bell, /function DesktopPanel/);
assert.match(bell, /useEscapeToClose\(onClose\)/);
assert.match(bell, /role="dialog"/);

console.log("✓ ux-round-two: 7 pins hold");
