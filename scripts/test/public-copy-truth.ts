/**
 * The public site must say what Loki is today, in words a newcomer reads.
 *
 * The 2026-10-01 sweep found 37 false and 42 stale claims across ~25 public
 * pages: a homepage pitching a retired "Beacon" tier, a "Live" badge against
 * the fleet rule, "client work" for a studio that has no clients, a dead
 * Lightning address, a frozen "daily" Frontier page, a sitemap listing 5 of
 * ~25 pages. This pins the rules so the same words cannot creep back.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { publicPagePaths } from "../../src/lib/public-pages";
import { COMPARE_GROUPS } from "../../src/config/compare";
import { ECOSYSTEM } from "../../src/config/ecosystem";
import { KIND_OPTIONS, kindLabel } from "../../src/config/fleet-list";

const PUBLIC_COPY = [
  "src/config/brand.ts",
  "src/config/marketing-content.ts",
  "src/config/how-it-works.ts",
  "src/config/problems-we-solve.ts",
  "src/components/public/ProblemsSection.tsx",
  "src/config/compare.ts",
  "src/config/auth.ts",
  "src/config/fleet-site-copy.ts",
  "src/app/page.tsx",
  "src/app/fleet/page.tsx",
  "src/app/why/page.tsx",
  "src/app/how-it-works/page.tsx",
  "src/app/compare/page.tsx",
  "src/components/public/PublicFooter.tsx",
];

// Strings only — comments may quote the old copy to say why it went.
const stringsOf = (raw: string) =>
  [
    ...raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g),
  ]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? "")
    .join("\n");

const FORBIDDEN: [RegExp, string][] = [
  [/\bBeacon\b/, "a tier of the autonomy ladder removed 2026-06-11"],
  [/Personal Systems/, "the life-OS kicker from before the pivot"],
  [
    /client work|client sites?|our clients|studio'?s? clients/i,
    "bitbaum has no clients — Pilots and Concepts",
  ],
  [/Züritüütsch/, "Zurich is Dütsch / Züridütsch"],
  [/Local-first|Cross-model verification/i, "removed or never true"],
  [/distilled daily|frontier digest/i, "the Frontier producer was removed 2026-09-25"],
  // Assembled so this file does not trip the retired-name check itself.
  [new RegExp(["Fleet", "Crown"].join(""), "i"), "the old name"],
  [/one-person|\bsolo\b/i, "never frame the studio as one person"],
];

for (const file of PUBLIC_COPY) {
  const text = stringsOf(readFileSync(file, "utf8"));
  for (const [re, why] of FORBIDDEN) {
    const hit = text.match(re);
    assert.equal(hit, null, `${file}: "${hit?.[0]}" in public copy — ${why}`);
  }
}

// The website-change page names the studio; it is spelled bitbaum, lowercase.
for (const file of ["src/components/public/WebsiteChangeBrief.tsx", "src/app/change/page.tsx"]) {
  const hit = stringsOf(readFileSync(file, "utf8")).match(/\bBitbaum\b/);
  assert.equal(hit, null, `${file}: "Bitbaum" — the studio is spelled bitbaum`);
}

// /fleet shows the apps.conf kind to strangers. "client-app" is a provisioning
// fact; the public word is pilot — every label, and nothing else on the page.
for (const kind of KIND_OPTIONS) {
  assert.doesNotMatch(kindLabel(kind), /client/i, `kind "${kind}" shows as "${kindLabel(kind)}"`);
}
{
  const hit = stringsOf(readFileSync("src/app/fleet/page.tsx", "utf8")).match(/\bclients?\b/i);
  assert.equal(hit, null, `src/app/fleet/page.tsx: "${hit?.[0]}" — bitbaum has no clients`);
}

// Jargon a newcomer cannot parse stays off the pages a newcomer lands on.
// (/how-it-works "Under the hood" may use the word — it explains it.)
for (const file of ["src/config/brand.ts", "src/app/page.tsx", "src/config/auth.ts"]) {
  const hit = stringsOf(readFileSync(file, "utf8")).match(
    /control plane|\bfleet scale\b|agent operations/i,
  );
  assert.equal(hit, null, `${file}: "${hit?.[0]}" on a newcomer page — say what it does`);
}

// "Live" as a STATUS label is out (fleet rule: nothing is Live, everything is beta).
const page = readFileSync("src/app/page.tsx", "utf8");
assert.ok(!/\?\s*"Live"/.test(page), "the hero badge must not say Live");

// Every public page the nav or sitemap names exists (or redirects from a page).
for (const path of publicPagePaths()) {
  const dir = `src/app${path}`;
  assert.ok(
    existsSync(`${dir}/page.tsx`) || existsSync(`${dir}/page.mdx`) || existsSync(`${dir}.tsx`),
    `public path ${path} has no page`,
  );
}
for (const required of ["/how-it-works", "/compare", "/why", "/pricing", "/docs", "/download"]) {
  assert.ok(publicPagePaths().includes(required), `sitemap/nav missing ${required}`);
}

// Every comparison row cites the vendor page it was read from.
for (const group of COMPARE_GROUPS) {
  for (const row of group.rows) {
    assert.match(row.source, /^https:\/\//, `compare row ${row.name} has no source`);
  }
}

// The Lightning address must be one that answers (getalby 404s — checked 2026-10-01).
assert.notEqual(ECOSYSTEM.support.lightningAddress, "orangecat@getalby.com");

console.log("public-copy-truth: ok");
