import assert from "node:assert/strict";
import { privatePortfolio } from "../../src/lib/register/private-portfolio";
import type { FleetMap, FleetMapEntry } from "../../src/lib/register/map";

function entry(slug: string, client: FleetMapEntry["client"]): FleetMapEntry {
  return {
    slug,
    name: slug.toUpperCase(),
    what: `${slug} purpose`,
    status: "live",
    since: null,
    client,
    urls: {
      live: `https://${slug}.example`,
      repo: `https://github.com/x/${slug}`,
      orangecat: null,
      solon: null,
    },
  } as unknown as FleetMapEntry;
}

const map = {
  projects: [
    entry("loki", null),
    entry("s-ink", { consentedAt: "2026-10-15" }),
    entry("aoz", { consentedAt: null }),
    entry("farmaciadelparco", { consentedAt: null }),
  ],
} as unknown as FleetMap;

const out = privatePortfolio(map);
assert.deepEqual(
  out.map((p) => p.slug),
  ["aoz", "farmaciadelparco"],
  "only client work without consent; own work and consented clients are public already",
);
assert.equal(out[0].live, "https://aoz.example");
assert.equal("repo" in out[0], false, "a client's repo never travels to the private area");
assert.equal("urls" in out[0], false);
console.log("private-portfolio: ok");
