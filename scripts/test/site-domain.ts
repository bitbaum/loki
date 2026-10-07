// A site's own domain — the pure rules in src/lib/site-domain.ts, and their
// agreement with scripts/hetzner/attach-domain.sh, which is the authority on
// the box. The owner is shown records by this module and the box checks them
// with the script; if the two disagree, the panel tells people to set records
// the script then refuses.
//
// Run: npx tsx scripts/test/site-domain.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachDomainCommand,
  dnsRecordsFor,
  dnsVerdict,
  isApexDomain,
  normalizeOwnDomain,
  siteAddresses,
  sitesBoxIp,
} from "@/lib/site-domain";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, msg: string) {
  try {
    assert.deepEqual(actual, expected);
    pass++;
  } catch (e) {
    fail++;
    console.error(`✗ ${msg}`, e);
  }
}
function ok(cond: unknown, msg: string) {
  try {
    assert.ok(cond);
    pass++;
  } catch (e) {
    fail++;
    console.error(`✗ ${msg}`, e);
  }
}

const BASE = "orangecat.ch";
const IP = "167.233.22.31";
const root = join(__dirname, "..", "..");
const script = readFileSync(join(root, "scripts/hetzner/attach-domain.sh"), "utf8");
const boxEnv = readFileSync(join(root, "scripts/hetzner/_box-env.sh"), "utf8");

// ------------------------------------------------------------- normalising
eq(normalizeOwnDomain("evig.ch", BASE), { ok: true, domain: "evig.ch" }, "plain domain");
eq(
  normalizeOwnDomain("  https://EVIG.ch/shop?x=1 ", BASE),
  { ok: true, domain: "evig.ch" },
  "pasted URL",
);
eq(normalizeOwnDomain("evig.ch.", BASE), { ok: true, domain: "evig.ch" }, "trailing dot");
eq(normalizeOwnDomain("shop.evig.ch", BASE), { ok: true, domain: "shop.evig.ch" }, "subdomain");
eq(
  normalizeOwnDomain("zürich-velo.ch", BASE),
  { ok: true, domain: "xn--zrich-velo-9db.ch" },
  "an internationalised name becomes the punycode DNS and Caddy use",
);
ok(!normalizeOwnDomain("", BASE).ok, "empty is refused");
ok(!normalizeOwnDomain("evig", BASE).ok, "a bare word is not a domain");
ok(!normalizeOwnDomain("127.0.0.1", BASE).ok, "an IP address is not a domain");
ok(!normalizeOwnDomain("evig.orangecat.ch", BASE).ok, "the free address is not an own domain");
ok(!normalizeOwnDomain("orangecat.ch", BASE).ok, "nor is the base domain itself");
ok(
  normalizeOwnDomain("notorangecat.ch", BASE).ok,
  "a domain merely ending in the same letters is fine",
);

// ----------------------------------------------------------------- records
ok(isApexDomain("evig.ch") && !isApexDomain("shop.evig.ch"), "apex = two labels");
eq(
  dnsRecordsFor("evig.ch", "evig", BASE, IP),
  [
    { type: "A", name: "evig.ch", value: IP },
    { type: "CNAME", name: "www.evig.ch", value: "evig.orangecat.ch" },
  ],
  "apex: A to the box, www CNAME to the free host",
);
eq(
  dnsRecordsFor("shop.evig.ch", "evig", BASE, IP),
  [{ type: "CNAME", name: "shop.evig.ch", value: "evig.orangecat.ch" }],
  "subdomain: one CNAME",
);
// The script prints the same records when it refuses.
ok(/\$DOMAIN +A +\$HETZNER_IP/.test(script), "script prints the A record the panel shows");
ok(
  /www\.\$DOMAIN +CNAME +\$SLUG\.\$BASE/.test(script),
  "script prints the www CNAME the panel shows",
);
ok(
  /\$DOMAIN +CNAME +\$SLUG\.\$BASE/.test(script),
  "script prints the subdomain CNAME the panel shows",
);
ok(
  script.includes(`awk -F. '{print $(NF-1)"."$NF}'`),
  "script's apex test is two labels, like isApexDomain",
);

// The box address has one SSOT on the shell side; the app's default must match.
const boxIp = boxEnv.match(/HETZNER_IP="\$\{HETZNER_IP:-([0-9.]+)\}"/)?.[1];
eq(sitesBoxIp(), boxIp, "sitesBoxIp() default matches _box-env.sh HETZNER_IP");

// ----------------------------------------------------------------- verdict
eq(dnsVerdict("evig.ch", { a: [IP], aaaa: [] }, IP, null), { ready: true }, "A to the box → ready");
eq(dnsVerdict("evig.ch", { a: [], aaaa: [] }, IP, null).ready, false, "no record → not ready");
const elsewhere = dnsVerdict("evig.ch", { a: ["192.0.2.1"], aaaa: [] }, IP, null);
ok(
  !elsewhere.ready && elsewhere.reason === "elsewhere" && elsewhere.detail.includes("192.0.2.1"),
  "names where it points instead",
);
ok(
  !dnsVerdict("evig.ch", { a: [IP, "192.0.2.1"], aaaa: [] }, IP, null).ready,
  "every A record must be the box",
);
const v6 = dnsVerdict("evig.ch", { a: [IP], aaaa: ["2001:db8::1"] }, IP, null);
ok(
  !v6.ready && v6.reason === "ipv6-elsewhere",
  "a stray AAAA is refused (Let's Encrypt would validate there)",
);
eq(
  dnsVerdict("evig.ch", { a: [IP], aaaa: ["2001:db8::1"] }, IP, "2001:db8::1"),
  { ready: true },
  "the box's own AAAA is fine",
);

// --------------------------------------------------------------- addresses
const apps = [
  { domains: ["heidi.orangecat.ch"] },
  { domains: ["evig.ch", "www.evig.ch", "evig.orangecat.ch"] },
  { domains: ["sinktattoo.com", "www.sinktattoo.com"] },
  { domains: ["xhiva.orangecat.ch", "xhiva-long.orangecat.ch"] },
];
eq(
  siteAddresses("https://heidi.orangecat.ch", apps, BASE),
  { ownDomain: null, freeHost: "heidi.orangecat.ch" },
  "free only",
);
eq(
  siteAddresses("https://evig.ch/", apps, BASE),
  { ownDomain: "evig.ch", freeHost: "evig.orangecat.ch" },
  "own domain + its free host",
);
eq(
  siteAddresses("https://sinktattoo.com", apps, BASE),
  { ownDomain: "sinktattoo.com", freeHost: null },
  "own domain with no free host",
);
eq(
  siteAddresses("https://xhiva-long.orangecat.ch", apps, BASE),
  { ownDomain: null, freeHost: "xhiva-long.orangecat.ch" },
  "a second free host is still free",
);
eq(
  siteAddresses("https://someone.vercel.app", apps, BASE),
  null,
  "a site we do not host gets no button",
);
eq(
  siteAddresses("https://orangecat.ch/projects/x", apps, BASE),
  null,
  "an OrangeCat listing page is not a hosted site",
);
eq(siteAddresses(null, apps, BASE), null, "no live URL");

eq(
  attachDomainCommand("evig", "evig.ch"),
  "bash scripts/hetzner/attach-domain.sh evig evig.ch",
  "attach command",
);
eq(
  attachDomainCommand("evig", null),
  "bash scripts/hetzner/attach-domain.sh evig --detach",
  "detach command",
);

console.log(`${fail === 0 ? "✓" : "✗"} site-domain: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
