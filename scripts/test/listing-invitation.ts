// When Loki may ask an owner to list a project publicly — and when it must not.
//
// The asking is the load-bearing half of the consent model: a toggle nobody
// finds collects one answer, and it is no, after which an empty catalogue looks
// like a broken feature and gets "fixed" by widening the query. So the rule has
// to be exercised, not just written down.
//
// Pure input → boolean, so this runs with no database and no browser.
// Run: npx tsx scripts/test/listing-invitation.ts
import { shouldInviteToPublicCatalogue } from "../../src/lib/listing-invitation";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

/** A project that SHOULD be asked about: active, has a repo, never answered. */
const eligible = {
  listedPublicly: false,
  dismissedAt: null,
  isActive: true,
  gitUrl: "https://github.com/someone/thing",
  readonly: false,
};

ok(shouldInviteToPublicCatalogue(eligible), "a real, active, unanswered project is asked about");

// ── The four ways the answer is already settled ────────────────────────────
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, listedPublicly: true }),
  "already listed: there is nothing left to ask",
);
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, dismissedAt: new Date() }),
  "already declined: no means no, permanently",
);
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, dismissedAt: "2026-01-01T00:00:00Z" }),
  "a declined-at timestamp read back as a STRING still silences the prompt",
);
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, readonly: true }),
  "viewing someone else's project: never the viewer's decision to take",
);

// ── The readiness bar ──────────────────────────────────────────────────────
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, gitUrl: null }),
  "no repository: a placeholder is not a project worth a shop window",
);
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, gitUrl: "   " }),
  "a whitespace-only repo URL is not a repository",
);
ok(
  !shouldInviteToPublicCatalogue({ ...eligible, isActive: false }),
  "retired projects are not candidates",
);

// The bar is repo-and-active, NOT has-a-live-site. /fleet's own facets include
// "Being built" beside "Live", so requiring a deployment would ask only the
// projects that least need the exposure.
ok(
  shouldInviteToPublicCatalogue({ ...eligible }),
  "a project with no live URL is still asked — 'being built' belongs in the catalogue",
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
