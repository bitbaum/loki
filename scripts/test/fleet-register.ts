// The register has one way to lie: dropping a project because two systems call
// it by different names. Every alias that has actually bitten (aoz, datacat,
// sink, sbb, annushka) is pinned here, and the join is exercised on a fixture
// that contains all four surfaces at once.
// Run: npx tsx scripts/test/fleet-register.ts
import { parseAppsConf } from "@/lib/register/apps-conf";
import {
  buildFleetRegister,
  canonicalSlug,
  commerce,
  isClientSite,
  isPaid,
  repoFromGitUrl,
  summarize,
  usefulDescription,
} from "@/lib/register/build";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// ------------------------------------------------------------- apps.conf
const CONF = `
# name|port|domains|repo_path|app_dir|db|owner|kind|status|plan|price|since
kivvi|4005|kivvi.orangecat.ch|/home/g/dev/kivvi|.|kivvi|RevampIT|client-app|live|retainer|900|2026-03-01
aoz-wohnen|4008|aoz.orangecat.ch|/home/g/dev/aoz-begleitung|.|-|AOZ|client-app|live|-|-|-
sink|4019|sinktattoo.com,www.sinktattoo.com|/home/g/dev/s-ink|.|-|S-Ink|client-site|live|-|-|-
factory-sep11-0110|4031|factory-sep11-0110.orangecat.ch|/home/ubuntu/dev/factory-sep11-0110|.|-|bitbaum|demo|demo|-|-|2026-09-11
short|4099|short.orangecat.ch
`;
const apps = parseAppsConf(CONF);
ok(apps.length === 5, "parses every non-comment row");
ok(apps[2].domains.length === 2 && apps[2].domains[0] === "sinktattoo.com", "splits domains");
ok(apps[0].port === 4005 && apps[0].plan === "retainer", "keeps port and terms");
ok(apps[4].kind === "-" && apps[4].appDir === ".", "short rows get '-' defaults");

// --------------------------------------------------------------- aliases
ok(canonicalSlug("aoz-wohnen") === "aoz-begleitung", "aoz-wohnen → aoz-begleitung");
ok(canonicalSlug("datacat-web") === "datacat", "datacat-web → datacat");
ok(canonicalSlug("sink") === "s-ink", "sink → s-ink");
ok(canonicalSlug("sbb-lost-found") === "sbb-fundbuero", "sbb-lost-found → sbb-fundbuero");
ok(canonicalSlug("Annushka Wild Spirit Art") === "wild-spirit", "display name → wild-spirit");
ok(canonicalSlug("Prime tower") === "prime-tower", "spaces → hyphens");
ok(repoFromGitUrl("https://github.com/bitbaum/datacat.git") === "datacat", "repo from git url");
ok(repoFromGitUrl("git@github.com:bitbaum/s-ink") === "s-ink", "repo from ssh url");
ok(repoFromGitUrl(null) === null, "no url → null");

// ------------------------------------------------------------------ join
const rows = buildFleetRegister(
  [
    {
      id: "1",
      name: "kivvi",
      description: "ERP for RevampIT",
      gitUrl: "https://github.com/bitbaum/kivvi.git",
      orangecatProjectId: null,
    },
    {
      id: "2",
      name: "aoz-begleitung",
      // What the site factory writes into every project it provisions.
      description: "Website at https://aoz.orangecat.ch",
      gitUrl: "https://github.com/bitbaum/aoz-begleitung.git",
    },
    { id: "3", name: "Annushka Wild Spirit Art", gitUrl: null },
    {
      id: "4",
      name: "orangecat",
      gitUrl: "https://github.com/bitbaum/orangecat.git",
      orangecatProjectId: "cb09",
    },
    { id: "5", name: "retired", gitUrl: null, isActive: false },
    { id: "6", name: "Sink client", slug: "s-ink", gitUrl: null },
  ],
  apps,
  // The organisation that CLAIMS each project, keyed by project slug — not a set
  // of organisation names. scripts/test/solon-claims.ts pins why.
  new Map([["orangecat", "orangecat"]]),
);
const by = Object.fromEntries(rows.map((r) => [r.slug, r]));

ok(!("retired" in by), "inactive projects are excluded");
ok(
  by["aoz-begleitung"]?.site?.host === "aoz.orangecat.ch",
  "aoz-wohnen row attaches to aoz-begleitung via alias",
);
ok(by["aoz-begleitung"]?.loki?.id === "2", "…and keeps its Loki profile");
ok(by["s-ink"]?.site?.host === "sinktattoo.com", "sink row attaches to the stored slug s-ink");
ok(by["s-ink"]?.loki?.id === "6", "stored slug wins over the display name");
ok(by["orangecat"]?.orangecat?.projectId === "cb09", "OrangeCat link carried");
ok(by["orangecat"]?.solon?.slug === "orangecat", "Solon organisation from the project's claim");
ok(by["kivvi"]?.solon === null && by["kivvi"]?.orangecat === null, "no link → null, not false");
ok(
  by["factory-sep11-0110"]?.loki === null && by["factory-sep11-0110"]?.site !== null,
  "hosted-only project appears with site and no profile",
);
ok(by["wild-spirit"]?.loki?.id === "3", "display-name-only project folds to wild-spirit");

const s = summarize(rows);
// 7 projects: five profiles (one inactive, excluded) + two hosted-only rows
// (factory-sep11-0110 and `short`); 5 sites: kivvi, aoz, sink, factory, short.
ok(
  s.projects === 7 && s.sites === 5 && s.loki === 5 && s.orangecat === 1 && s.solon === 1,
  `summary counts (${JSON.stringify(s)})`,
);

// ---------------------------------------------------------- descriptions
// A register of slugs tells a reader who is not the author nothing. The line
// comes from the project profile — and the factory's own filler does not count
// as one, or every provisioned site would "describe" itself with its address.
ok(by["kivvi"]?.description === "ERP for RevampIT", "description carried from the profile");
ok(by["aoz-begleitung"]?.description === null, "factory boilerplate is treated as no description");
ok(by["short"]?.description === null, "a hosted-only row has no description to carry");
ok(usefulDescription("  ") === null && usefulDescription(null) === null, "blank is absent");
ok(
  usefulDescription("Website at https://x.ch") === null &&
    usefulDescription("WEBSITE AT http://x.ch") === null,
  "boilerplate is matched whatever its case or scheme",
);
ok(
  usefulDescription("A website at https://x.ch that does one thing") ===
    "A website at https://x.ch that does one thing",
  "a real sentence that merely mentions a website survives",
);

// ------------------------------------------------------------- commerce
// The page reports what the studio earns. That number must come from the
// register, not from prose — so these pin the arithmetic, including the
// uncomfortable case the real register is actually in.
// The row is served publicly. A client's terms are not ours to publish, and a
// field added "just for the page" is how that stops being true — so assert the
// absence, not just the presence of what we do carry.
const publicKeys = Object.keys(by["kivvi"]!.site!).sort().join(",");
ok(
  publicKeys === "host,kind,owner,since,status,url",
  `public site payload carries no terms (${publicKeys})`,
);
ok(by["kivvi"]?.site?.since === "2026-03-01", "a start date IS public — it is a date, not a price");
ok(isClientSite(by["kivvi"]), "a site owned by RevampIT is client work");
ok(!isClientSite(by["factory-sep11-0110"]), "a site owned by bitbaum is our own");
ok(!isClientSite(by["short"]), "owner '-' is not a client — unknown is not a sale");
ok(isPaid("900") && isPaid("CHF 1200"), "a price above zero is paid");
ok(!isPaid("0") && !isPaid("-") && !isPaid("favour"), "zero, blank and favour are not paid");

const c = commerce(apps);
// kivvi (RevampIT, 900), aoz (AOZ, no terms), sink (S-Ink, no terms) are live
// client sites; factory is ours and `short` has no owner.
ok(c.engagements === 3, `three live engagements (${c.engagements})`);
ok(
  c.clients.join(",") === "AOZ,RevampIT,S-Ink",
  `clients listed once each, sorted (${c.clients.join(",")})`,
);
ok(c.paying === 1, `one of them pays (${c.paying})`);
ok(c.priced === 1, `terms recorded for one (${c.priced})`);
ok(c.pipeline === 0, "no prospects in this fixture");

const favour = parseAppsConf(`x|1|x.ch|/r|.|-|Client A|client-site|live|favour|0|-`);
ok(commerce(favour).paying === 0, "a favour at price 0 is an engagement, not revenue");
ok(commerce(favour).priced === 1, "…but its terms ARE recorded — 'favour' is a decision");

console.log(`fleet-register: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
