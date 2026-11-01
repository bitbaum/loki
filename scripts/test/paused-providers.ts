// A provider paused in lib/auth-providers.ts is neither shown nor mounted,
// even when its keys are set; one that is not paused follows its keys.
// Run: npx tsx scripts/test/paused-providers.ts
import { getEnabledAuthProviders, PAUSED_PROVIDERS } from "@/lib/auth-providers";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

Object.assign(process.env, {
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  X1_CONSUMER_KEY: "key",
  X1_CONSUMER_SECRET: "secret",
});
const enabled = getEnabledAuthProviders();
for (const p of ["github", "google", "x"] as const) {
  ok(
    `${p}: ${PAUSED_PROVIDERS[p] ? "paused, so off" : "keys set, so on"}`,
    enabled[p] === !PAUSED_PROVIDERS[p],
  );
}
ok(
  "every pause says why and how to lift it",
  Object.values(PAUSED_PROVIDERS).every((r) => (r ?? "").length > 40),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
