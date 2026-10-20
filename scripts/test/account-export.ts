// Data controls: the account export must never carry credential hashes, and the
// manifest must state exactly what it withheld.
//
// The projection is no longer this module's own deny-list — it is toExportUser,
// the same schema-exhaustive allow-list /api/me uses (scripts/test/user-client-view.ts
// is what keeps that list honest as the schema grows). What this file checks is
// the export-specific part: billing ids are dropped, everything else survives,
// and the manifest cannot claim an exclusion it did not make.
// Run: npx tsx scripts/test/account-export.ts
import { toExportUser, buildExportManifest, ACCOUNT_EXPORT_FILENAME } from "@/lib/account-export";
import {
  USER_CLIENT_FIELDS,
  USER_EXPORT_OMITTED_FIELDS,
  USER_WITHHELD_FIELDS,
} from "@/lib/user-client-view";
import type { User } from "@/db/schema/users";

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

const userRow = {
  id: "u-1",
  name: "G",
  email: "g@example.com",
  emailVerified: null,
  image: null,
  username: "g",
  isDefault: false,
  privateBuilder: false,
  buildEngine: "own",
  onboardedAt: null,
  orangecatActorId: null,
  plan: "pro",
  planStatus: "active",
  planExpiresAt: null,
  privateZonePinSetAt: new Date("2026-01-01"),
  fleetSettings: { a: 1 },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  passwordHash: "bcrypt$secret",
  privateZonePinHash: "scrypt$pin",
} as unknown as User;

const exported = toExportUser(userRow) as Record<string, unknown>;
const serialized = JSON.stringify(exported);

// Secrets: withheld because they are secret, for every projection.
for (const field of Object.keys(USER_WITHHELD_FIELDS)) {
  ok(!(field in exported), `${field} absent from export`);
}
ok(!serialized.includes("bcrypt$secret"), "serialized export does not contain the password hash");
ok(!serialized.includes("scrypt$pin"), "serialized export does not contain the PIN hash");

// Fields withheld from the export specifically.
for (const field of USER_EXPORT_OMITTED_FIELDS) {
  ok(!(field in exported), `${field} omitted from export`);
}

// Everything else the owner may see must survive — an export that quietly drops
// data fails its purpose (right of access) as surely as one that leaks.
const omitted = new Set<string>(USER_EXPORT_OMITTED_FIELDS);
for (const field of USER_CLIENT_FIELDS) {
  if (omitted.has(field)) continue;
  ok(field in exported, `${field} present in export`);
}
ok(exported.email === "g@example.com", "email kept");
ok(exported.plan === "pro", "plan kept");
ok(JSON.stringify(exported.fleetSettings) === JSON.stringify({ a: 1 }), "fleetSettings kept");
ok(userRow.passwordHash === "bcrypt$secret", "input row not mutated");

// The manifest is generated from the same lists, so it cannot describe an
// exclusion that did not happen — assert the linkage, not a copy of the words.
const manifest = buildExportManifest("u-1", ["a", "b"]);
ok(manifest.user_id === "u-1", "manifest user_id");
ok(Array.isArray(manifest.scope) && manifest.scope.length === 2, "manifest scope");
for (const field of Object.keys(USER_WITHHELD_FIELDS)) {
  ok(
    manifest.excluded.some((e) => e.includes(field)),
    `manifest names ${field} as excluded`,
  );
}
for (const field of USER_EXPORT_OMITTED_FIELDS) {
  ok(
    manifest.excluded.some((e) => e.includes(field)),
    `manifest names ${field} as excluded`,
  );
}
ok(
  manifest.excluded.every((line) =>
    line
      .split(":")
      .slice(1)
      .join(":")
      .split(",")
      .map((f) => f.trim())
      .every((f) => !f || !(f in exported)),
  ),
  "every field the manifest claims to exclude really is absent",
);
ok(ACCOUNT_EXPORT_FILENAME.endsWith(".json"), "filename is json");

if (fail > 0) {
  console.error(`account-export: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`account-export: ${pass} checks passed`);
