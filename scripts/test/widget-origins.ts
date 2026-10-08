// A site's widget works on every address the site is hosted at — and on no
// other site's.
//
// The token's `origins` list is written at install time; apps.conf (the
// hosting SSOT) can gain addresses later. xhiva (2026-10-08) got a short host,
// xhiva.orangecat.ch, in apps.conf only — boot answered {active:false} there
// while the long host still rendered the widget. This pins the rule that
// fixed it (src/lib/widget/origin.ts): the token names the site, apps.conf
// says where the site lives.
// Run: npx tsx scripts/test/widget-origins.ts
import { parseAppsConf } from "../../src/lib/register/apps-conf";
import { expandWidgetOrigins, isWidgetOriginAllowed } from "../../src/lib/widget/origin";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

const apps = parseAppsConf(
  [
    "# name|port|domains|repo_path|app_dir|db|owner|kind|status",
    "xhiva|4032|xhiva.orangecat.ch,xhiva-art-refresh-abc.orangecat.ch|/x|.|-|ops|client-site|live",
    "other|4033|other.orangecat.ch,www.other.ch|/o|.|-|ops|client-site|live",
  ].join("\n"),
);
const LONG = "https://xhiva-art-refresh-abc.orangecat.ch";
const SHORT = "https://xhiva.orangecat.ch";

console.log("widget origins follow the site's hosted addresses");

ok(
  isWidgetOriginAllowed({ tokenOrigins: [LONG], origin: SHORT, allowMissingOrigin: false }, apps),
  "a site's address added in apps.conf after install is allowed",
);
ok(
  isWidgetOriginAllowed({ tokenOrigins: [LONG], origin: LONG, allowMissingOrigin: false }, apps),
  "the address on the token is still allowed",
);
ok(
  !isWidgetOriginAllowed(
    { tokenOrigins: [LONG], origin: "https://other.orangecat.ch", allowMissingOrigin: false },
    apps,
  ),
  "another hosted site's address is NOT allowed",
);
ok(
  !isWidgetOriginAllowed(
    { tokenOrigins: [LONG], origin: "https://evil.example", allowMissingOrigin: false },
    apps,
  ),
  "an unrelated origin is NOT allowed",
);
ok(
  !isWidgetOriginAllowed(
    { tokenOrigins: [LONG], origin: "http://xhiva.orangecat.ch", allowMissingOrigin: false },
    apps,
  ),
  "only https: the plain-http twin of an address is NOT allowed",
);
ok(
  isWidgetOriginAllowed(
    {
      tokenOrigins: ["https://www.other.ch"],
      origin: "https://other.orangecat.ch",
      allowMissingOrigin: false,
    },
    apps,
  ),
  "a custom domain on the token opens the site's preview host too",
);
ok(
  isWidgetOriginAllowed(
    { tokenOrigins: [], origin: "https://anything.example", allowMissingOrigin: false },
    apps,
  ) && isWidgetOriginAllowed({ tokenOrigins: null, origin: null, allowMissingOrigin: false }, apps),
  "an empty allowlist still means any origin",
);
ok(
  isWidgetOriginAllowed({ tokenOrigins: [LONG], origin: null, allowMissingOrigin: true }, apps) &&
    !isWidgetOriginAllowed({ tokenOrigins: [LONG], origin: null, allowMissingOrigin: false }, apps),
  "a missing Origin passes only where the route allows it (boot), not on input routes",
);
ok(
  isWidgetOriginAllowed(
    {
      tokenOrigins: ["https://unhosted.example"],
      origin: "https://unhosted.example",
      allowMissingOrigin: false,
    },
    apps,
  ) &&
    !isWidgetOriginAllowed(
      { tokenOrigins: ["https://unhosted.example"], origin: SHORT, allowMissingOrigin: false },
      apps,
    ),
  "a token for a site not in apps.conf keeps exactly its own list",
);
ok(
  [...expandWidgetOrigins([LONG], apps)].sort().join(" ") === [LONG, SHORT].sort().join(" "),
  "expansion adds exactly the site's own addresses",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
