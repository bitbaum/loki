// Client work is shown publicly only once the client agreed
// (src/lib/register/client-work.ts). These pin the rule, the lists read
// straight from the projects table (portfolio.ts), the footer that cannot know
// consent at all, and the map field the bitbaum portfolio reads.
// Run: npx tsx scripts/test/client-work-consent.ts
import { parseAppsConf } from "@/lib/register/apps-conf";
import { buildFleetRegister } from "@/lib/register/build";
import {
  consentIso,
  hostingSaysClient,
  isClientWork,
  mayShowPublicly,
} from "@/lib/register/client-work";
import { buildFleetMap } from "@/lib/register/map";
import { hostingRowFor, withoutPrivateClientWork } from "@/lib/register/portfolio";
import { listedSites } from "../generate-fleet-sites";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// ------------------------------------------------------------------ rule
ok(hostingSaysClient({ kind: "client-site", owner: "bitbaum" }), "a client kind is client work");
ok(hostingSaysClient({ kind: "product", owner: "AOZ" }), "a third-party owner is client work");
ok(!hostingSaysClient({ kind: "product", owner: "bitbaum" }), "our product is ours");
ok(!hostingSaysClient({ kind: "demo", owner: "-" }), "an unowned demo is ours");
ok(!hostingSaysClient(null), "no hosting row says nothing");
ok(isClientWork(false, { kind: "client-app", owner: "AOZ" }) === false, "explicit false wins");
ok(isClientWork(true, null) === true, "explicit true wins with no hosting row");
ok(isClientWork(null, { kind: "client-app", owner: "AOZ" }) === true, "null defers to hosting");
ok(consentIso(null) === null && consentIso("not a date") === null, "no or bad date is no consent");
ok(consentIso(new Date("2026-10-01T00:00:00Z")) === "2026-10-01T00:00:00.000Z", "date → ISO");
ok(mayShowPublicly(false, null), "our own work needs no consent");
ok(!mayShowPublicly(true, null), "client work without consent is private");
ok(mayShowPublicly(true, "2026-10-01T00:00:00Z"), "client work with consent may be shown");

// ------------------------------------------------- lists from the projects table
const apps = parseAppsConf(`
kivvi|4005|kivvi.orangecat.ch|/r/kivvi|.|-|RevampIT|client-app|live|-|-|-
heidi|4025|heidi.orangecat.ch|/r/heidi|.|-|bitbaum|product|live|-|-|-
`);
ok(hostingRowFor({ name: "kivvi" }, apps)?.owner === "RevampIT", "joins by name");
ok(
  hostingRowFor({ name: "Something", hostedApp: "heidi" }, apps)?.name === "heidi",
  "an explicit hosted_app link wins",
);
const kept = withoutPrivateClientWork(
  [
    { name: "kivvi" },
    { name: "heidi" },
    { name: "Francesco Tarallo", clientWork: true },
    { name: "Bakery", clientWork: true, portfolioConsentAt: "2026-10-02T10:00:00Z" },
    { name: "kivvi-mirror", hostedApp: "kivvi", clientWork: false },
  ],
  apps,
).map((p) => p.name);
ok(
  kept.join(",") === "heidi,Bakery,kivvi-mirror",
  `profiles keep own work and consented client work (${kept.join(",")})`,
);

// ---------------------------------------------------------------- footer
// The footer is generated, static and client-side: it cannot read consent, so
// it lists no client work at all — consented work is shown where consent is read.
const footer = listedSites(
  parseAppsConf(`
kivvi|4005|kivvi.orangecat.ch|/r/kivvi|.|-|RevampIT|client-app|live|-|-|-
sink|4019|sinktattoo.com|/r/s-ink|.|-|bitbaum|client-site|live|-|-|-
odd|4030|odd.orangecat.ch|/r/odd|.|-|Somebody|product|live|-|-|-
heidi|4025|heidi.orangecat.ch|/r/heidi|.|-|bitbaum|product|live|-|-|-
`),
).map((s) => s.slug);
ok(footer.join(",") === "heidi", `footer lists only our own products (${footer.join(",")})`);

// ------------------------------------------------------------------- map
const rows = buildFleetRegister(
  [
    { id: "1", name: "kivvi", gitUrl: null, portfolioConsentAt: "2026-10-01T00:00:00Z" },
    { id: "2", name: "heidi", gitUrl: null },
  ],
  apps,
);
const map = buildFleetMap(rows, new Map(), new Map(), new Date("2026-10-12T00:00:00Z"));
const entry = (slug: string) => map.projects.find((p) => p.slug === slug);
ok(
  entry("kivvi")?.client?.consentedAt === "2026-10-01T00:00:00.000Z",
  "a consented client entry carries its consent date for the portfolio",
);
ok(entry("kivvi")?.layer === "client", "client work sits in the client layer");
ok(entry("heidi")?.client === null, "our own entry carries client: null");

console.log(`client-work-consent: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
