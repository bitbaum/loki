/**
 * Step 3: a client's seat reaches the site itself — their own pass, never the
 * owner's — and someone whose "Make it real" was approved gets that seat.
 * Step 4: a visitor follows their note from a link, with no account.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createMemberPass, verifyMemberPass } from "../../src/lib/feedback/member-pass";
import { createOwnerPass } from "../../src/lib/feedback/owner-pass";
import { memberSiteUrl, MEMBER_PASS_HASH_KEY } from "../../widget/member-pass";
import { receiptLinkLabel, receiptText } from "../../widget/receipt";
import {
  createFeedbackClaimToken,
  verifyFeedbackClaimToken,
} from "../../src/lib/feedback/claim-token";
import { feedbackReceivedTemplate, feedbackShippedTemplate } from "../../src/lib/email";

process.env.AUTH_SECRET ??= "test-secret-for-member-pass";
const read = (p: string) => readFileSync(p, "utf8");
const project = "8d96d258-36f2-4b47-a897-9a5baeb6c296";
const person = "11111111-2222-4333-8444-555555555555";
const now = Date.parse("2026-10-19T08:00:00Z");

// ─── The member pass names a person on one project ──────────────────────────
const pass = createMemberPass(project, person, now);
assert.deepEqual(verifyMemberPass(pass, project, now), { userId: person });
assert.equal(verifyMemberPass(pass, "9e96d258-36f2-4b47-a897-9a5baeb6c296", now), null);
assert.equal(verifyMemberPass(pass, project, now + 91 * 86_400_000), null, "it expires");
assert.equal(
  verifyMemberPass(createOwnerPass(project, person, now), project, now),
  null,
  "an owner pass is not a member pass, nor the other way round",
);
assert.match(
  memberSiteUrl("https://bakery.example/#top", pass),
  new RegExp(`#${MEMBER_PASS_HASH_KEY}=`),
);
const memberPassSrc = read("src/lib/feedback/pass-holder.ts");
assert.match(
  memberPassSrc,
  /getProjectAccess\(named\.userId, projectId\)/,
  "the seat is read when used",
);

// The site files a member's note by the same rules as their project page.
const ingest = read("src/app/api/feedback/route.ts");
assert.match(
  ingest,
  /const member = fromOwner \? null : await passMember\(data\.memberPass, token\.projectId\);/,
);
assert.match(ingest, /askInLoki\(\{\s*userId: member\.userId,/);
assert.ok(
  ingest.indexOf("passMember(") < ingest.indexOf("bumpDuplicateFeedback("),
  "before the visitor's path, so a member's note never lands as a stranger's",
);
// The widget's sign-in door gives a member their own pass, never the owner's.
const door = read("src/app/api/widget/owner/route.ts");
assert.match(door, /memberSiteUrl\(back, createMemberPass\(token\.projectId, userId\)\)/);
assert.ok(
  door.indexOf("createMemberPass") < door.indexOf("createOwnerPass(token"),
  "members first",
);
// Their project page link carries theirs.
assert.match(
  read("src/app/(app)/projects/[id]/page.tsx"),
  /createMemberPass\(id, session\.user\.id\)/,
);
// The widget sends it only when there is no owner pass, and drops a refused one.
const model = read("widget/conversation-model.ts");
assert.match(model, /const member = ownerPass \? null : \(opts\.memberPass\?\.\(\) \?\? null\);/);
assert.match(model, /res\.member !== true\) opts\.onMemberRefused\?\.\(\)/);
const sent = { kind: "sent" as const, at: 0, owner: false, member: true, text: "Bigger logo" };
assert.equal(
  receiptText({ ...sent, note: "Sent to George. They decide, and you are told when it ships." }),
  "Got it — “Bigger logo”. Sent to George. They decide, and you are told when it ships.",
);
assert.equal(receiptLinkLabel(sent), "See it in Loki →");

// The owner's link is for the owner: the share card offers the seat instead.
const share = read("src/components/projects/PreviewShareCard.tsx");
assert.match(share, /Invite them as Client/);
assert.match(share, /Their notes\s+come to you\./);
// An approved /change request seats its requester as the site's client.
assert.match(
  read("src/lib/build-requests/decide.ts"),
  /upsertProjectMember\(projectId, row\.userId, "client"\)/,
);
assert.match(read("src/app/change/requests/[id]/page.tsx"), /\/projects\/\$\{row\.projectId\}#ask/);

// ─── Step 4: the way back, with no account ──────────────────────────────────
const link = createFeedbackClaimToken("f1", now);
assert.equal(
  verifyFeedbackClaimToken(link, now + 170 * 86_400_000),
  "f1",
  "months later, from a mail",
);
assert.equal(verifyFeedbackClaimToken(link, now + 181 * 86_400_000), null);
const page = read("src/app/claim-feedback/page.tsx");
assert.match(page, /getReporterFeedbackById\(id\)/, "the link opens the note itself");
assert.match(page, /<ReporterFeedbackCard row=\{row\} \/>/, "drawn as on My feedback");
assert.ok(
  page.indexOf("<ReporterFeedbackCard") < page.indexOf("<ClaimFeedback"),
  "an account is offered below the note, never in front of it",
);
const mail = read("src/lib/feedback/receipt-mail.ts");
assert.match(mail, /row\.source !== FEEDBACK_SOURCE\.VISITOR\) return;/, "visitors only");
assert.match(mail, /RECEIPTS_PER_ADDRESS_PER_DAY = 3/, "the form cannot fill someone's inbox");
assert.match(ingest, /if \(!fromOwner\) void mailReceiptToVisitor\(created\);/);
const received = feedbackReceivedTemplate({
  site: "Bakery",
  excerpt: "<script>x</script>",
  trackUrl: "https://loki.example/claim-feedback?token=a",
});
assert.doesNotMatch(received.html, /<script>/, "visitor words are escaped");
assert.match(received.text, /no account needed: https:\/\/loki\.example\/claim-feedback/);
assert.match(
  feedbackShippedTemplate({ site: "Bakery", excerpt: "x", trackUrl: "https://t.example" }).text,
  /Your report: https:\/\/t\.example/,
);
assert.match(
  read("src/lib/feedback/close-loop.ts"),
  /trackUrl: `\$\{appUrl\(\)\}\$\{feedbackClaimPath\(row\.id\)\}`/,
);
assert.match(read("widget/conversation.ts"), /Your email, to hear when it's fixed \(optional\)/);

console.log("✓ seat on the site, approved requesters seated, notes followed without an account");
