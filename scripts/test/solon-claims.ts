// A Solon organisation is attributed to a project only by its claim — never by
// sharing the project's name.
//
// Founding an organisation on Solon is permissionless, so this is the rule that
// keeps "someone founded an organisation called loki" from putting a stranger's
// organisation on Loki's public register. The claim itself is only recorded by
// Solon when the founder carried a grant Loki signed for their own identity
// (scripts/test/solon-grant.ts pins that half). Pure: no DB, no network.
import assert from "node:assert";
import { buildFleetRegister } from "@/lib/register/build";
import { claimsFrom } from "@/lib/register/solon";

const claims = claimsFrom([
  { slug: "orangecat", claimedProject: "orangecat" },
  // An organisation may live at a different address from the project it governs
  // — e.g. when the obvious name was already taken.
  { slug: "heidi-zh", claimedProject: "heidi" },
  // Squatting: an organisation sharing a project's name, claiming nothing.
  { slug: "loki", claimedProject: null },
]);

assert.strictEqual(claims.get("orangecat"), "orangecat");
assert.strictEqual(
  claims.get("heidi"),
  "heidi-zh",
  "an organisation governs the project it claims, whatever its own address",
);
assert.strictEqual(
  claims.has("loki"),
  false,
  "an organisation called loki that claims nothing governs nothing",
);

const rows = buildFleetRegister(
  [
    { id: "1", name: "loki", gitUrl: "https://github.com/bitbaum/loki.git" },
    { id: "2", name: "heidi", gitUrl: "https://github.com/bitbaum/heidi.git" },
    {
      id: "3",
      name: "kivvi",
      gitUrl: "https://github.com/bitbaum/kivvi.git",
      solonOrgSlug: "kivvi-board",
    },
  ],
  [],
  claims,
);
const by = Object.fromEntries(rows.map((r) => [r.slug, r]));

assert.strictEqual(by.loki.solon, null, "a squatted name does not attribute");
assert.deepStrictEqual(
  by.heidi.solon,
  { slug: "heidi-zh" },
  "a claim attributes, and to the organisation's real address",
);
assert.deepStrictEqual(
  by.kivvi.solon,
  { slug: "kivvi-board" },
  "an explicitly stored link still wins",
);

console.log("solon-claims: ok");
