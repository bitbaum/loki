import assert from "node:assert/strict";
import { DIGEST_CADENCES } from "../../src/db/schema/notification-preferences";
import { DIGEST_CADENCE_COPY, EMAIL_THEME, MAIL_KINDS, mailSubject } from "../../src/config/comms";
import { AUTH_COPY } from "../../src/config/auth";
import { NAV } from "../../src/config/navigation";
import { PALETTE } from "../../src/lib/palette";

for (const cadence of DIGEST_CADENCES) {
  assert.ok(DIGEST_CADENCE_COPY[cadence].label, `cadence ${cadence} has a label`);
}

assert.ok(MAIL_KINDS.includes("digest"));
assert.match(mailSubject("verify"), /email/i);
assert.match(mailSubject("feedback_shipped", "kivvi"), /kivvi/);
assert.ok(AUTH_COPY.forgot.title, "auth copy has the recovery title");
assert.equal(NAV.prompts.label, "Prompts");

assert.equal(EMAIL_THEME.header, PALETTE.dark.surfacePage);
assert.equal(EMAIL_THEME.page, PALETTE.light.surfacePage);
assert.notEqual(EMAIL_THEME.header, PALETTE.zinc[950], "email header uses brand surface, not zinc");

console.log("✓ comms SSOT tests passed");
