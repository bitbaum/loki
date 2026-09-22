/**
 * A flag has to say how old it is, and an expiry has to mean something.
 *
 * `Security risk`, `4 broken features` and `Deploy issue` are the TEXT of
 * project attributes someone — a person or an agent — typed. They reached the
 * list undated and unattributed, so a note written this morning and one typed
 * in June looked identical and outranked every other project equally.
 *
 * The data was never missing. `fetchAttributesByEntityIds` does `select()`,
 * pulling `updatedAt`, `source` and `valid_until` on every row, then dropped
 * all three in its grouping loop. Nothing extra is queried to show them.
 *
 * `valid_until` is the sharper case: it has existed on the attributes table
 * the whole time and NOTHING read it, so an author writing "this expires on
 * the 14th" was writing into a field with no consumer.
 *
 * The line this test defends: honouring an explicit expiry is not auto-decay.
 * An undated flag still stands forever, however old. Inventing a deadline for
 * someone else's security note would be worse than showing a stale one.
 *
 * Run: npx tsx scripts/test/flags-carry-their-age.ts
 */
import { getHealthSignals } from "@/components/projects/project-badges";
import { hasProjectAttention } from "@/lib/projects-page-stats";
import { signalHasExpired, type AttrProvenance } from "@/lib/project-signals";
import { PROJECT_ATTR } from "@/config/project-attrs";
import type { ProjectGridRow } from "@/components/projects/project-grid-row";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const SEC = PROJECT_ATTR.SECURITY_VULNERABILITY;
const attrs = { [SEC]: "Email verification bypass" };

const meta = (over: Partial<AttrProvenance[string]> = {}): AttrProvenance => ({
  [SEC]: { updatedAt: iso(23 * DAY), source: "loki-ui", validUntil: null, ...over },
});

const row = (m?: AttrProvenance) =>
  ({ id: "p", name: "p", description: null, attrs, attrMeta: m }) as unknown as ProjectGridRow;

console.log("flags-carry-their-age:");

check("THE BUG: a flag now carries when it was written and by what", () => {
  const [s] = getHealthSignals(attrs, meta());
  assert(Boolean(s), "no signal produced");
  assert(Boolean(s.updatedAt), "the signal has no updatedAt — the badge cannot show an age");
  assert(s.source === "loki-ui", `source lost: ${s.source}`);
});

check("without provenance it still renders, just undated", () => {
  // Callers that do not load meta must not crash or invent a date.
  const [s] = getHealthSignals(attrs);
  assert(Boolean(s), "signal disappeared when provenance was absent");
  assert(s.updatedAt === undefined, "an age was invented from nothing");
});

check("THE FIELD NOTHING READ: an expired flag stops showing", () => {
  const expired = meta({ validUntil: iso(1 * DAY) });
  assert(
    getHealthSignals(attrs, expired).length === 0,
    "valid_until is still being ignored — an author's expiry means nothing",
  );
});

check("an expiry in the future is not an expiry", () => {
  const live = meta({ validUntil: new Date(Date.now() + 7 * DAY).toISOString() });
  assert(getHealthSignals(attrs, live).length === 1, "a flag was cleared before its own deadline");
});

check("THE LINE: no expiry means it stands forever, however old", () => {
  // Not auto-decay. A two-year-old security note with no valid_until is still
  // a security note; guessing a deadline for it would be worse than staleness.
  const ancient = meta({ updatedAt: iso(900 * DAY), validUntil: null });
  assert(
    getHealthSignals(attrs, ancient).length === 1,
    "an undated flag decayed on its own — that policy was never agreed",
  );
});

check("a malformed valid_until never clears a live flag", () => {
  const junk = meta({ validUntil: "not a date" });
  assert(
    getHealthSignals(attrs, junk).length === 1,
    "a typo in valid_until silently cleared a security flag",
  );
  assert(signalHasExpired(junk, SEC) === false, "unparseable date read as expired");
});

check("the sort and the chip agree with the badge", () => {
  // The whole point of sharing one predicate: a project must not be hoisted to
  // the top of the page by a flag its own row refuses to display, and the
  // "Site issues" chip must not count one either.
  const expired = meta({ validUntil: iso(1 * DAY) });
  assert(
    hasProjectAttention(row(expired)) === false,
    "an expired flag still counts as attention — the project sorts first with nothing visible explaining why",
  );
  assert(hasProjectAttention(row(meta())) === true, "a live flag stopped counting as attention");
});

check("site-down still counts as attention regardless of attrs", () => {
  const down = {
    id: "p",
    name: "p",
    description: null,
    attrs: {},
    liveUrl: "https://x.test",
    siteOk: false,
  } as unknown as ProjectGridRow;
  assert(hasProjectAttention(down) === true, "a down site stopped counting");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
