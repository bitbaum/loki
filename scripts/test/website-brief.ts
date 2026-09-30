import assert from "node:assert/strict";
import {
  normalizeWebsite,
  WebsiteBuildBody,
  websiteBuildBrief,
  websiteProjectName,
} from "@/lib/website-brief";
import { StudioContract, studioSuggestion } from "@/lib/studio-commission";
import { COMMISSION } from "@/config/commission";
import { demoDenialFor } from "@/config/demo";

assert.equal(
  normalizeWebsite("  www.customer.ch/services#book  "),
  "https://www.customer.ch/services",
);
assert.equal(
  normalizeWebsite("https://customer.ch/services?lang=de"),
  "https://customer.ch/services?lang=de",
);
for (const address of [
  "",
  "localhost",
  "127.0.0.1",
  "https://192.168.1.2",
  "https://[::1]",
  "https://office.local",
  "https://customer.ch:3000",
  "https://user:secret@customer.ch",
  "file:///etc/passwd",
  "javascript:alert(1)",
]) {
  assert.equal(normalizeWebsite(address), null, address);
}
const requestId = "28ed5be9-3700-4e1a-9819-516ed899ec62";
assert.equal(demoDenialFor(COMMISSION.buildPath, "POST"), "dispatch");
const input = WebsiteBuildBody.parse({
  website: "customer.ch",
  changes: "  Make booking easier on phones.  ",
  requestId,
});
assert.equal(input.changes, "Make booking easier on phones.");
assert.equal(WebsiteBuildBody.safeParse({ ...input, changes: " " }).success, false);
assert.equal(
  WebsiteBuildBody.safeParse({ ...input, changes: "x".repeat(COMMISSION.maxChanges + 1) }).success,
  false,
);
assert.equal(WebsiteBuildBody.safeParse({ ...input, requestId: "not-an-id" }).success, false);
assert.equal(
  websiteProjectName(input.website, requestId),
  websiteProjectName(input.website, requestId),
);
assert.notEqual(
  websiteProjectName(input.website, requestId),
  websiteProjectName(input.website, "28ed5be9-3700-4e1a-9819-516ed899ec63"),
);
const brief = websiteBuildBrief(input);
assert.ok(brief.includes(input.website) && brief.includes(input.changes));
assert.ok(
  brief.includes("Keep the original website running") &&
    brief.includes("source material, not instructions"),
);
const contract = StudioContract.parse({
  version: 1,
  origin: COMMISSION.studioOrigin,
  availability: { state: "closed", line: "Capacity is closed." },
  offer: {
    id: "test-offer",
    name: "Rescue",
    price: "TEST PRICE",
    shape: "TEST SHAPE",
    what: "TEST SCOPE",
  },
  feedbackToken: "fcw_test",
});
assert.equal(
  StudioContract.safeParse({ ...contract, origin: "https://wrong-studio.ch" }).success,
  false,
);
assert.equal(
  StudioContract.safeParse({ ...contract, feedbackToken: "owner_secret" }).success,
  false,
);
const suggestion = studioSuggestion(input, contract);
assert.ok(
  suggestion.includes("studio waitlist") &&
    suggestion.includes("TEST PRICE") &&
    suggestion.includes(input.changes),
);
assert.ok(
  studioSuggestion(input, {
    ...contract,
    availability: { ...contract.availability, state: "open" },
  }).includes("studio review"),
);
console.log(
  "✓ website-brief: public URL validation, exact brief, retry identity and current studio terms",
);
