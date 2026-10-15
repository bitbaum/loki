/**
 * The founder's env PIN gates the founder's account only. Case from the live
 * site (2026-10-15): a new account was asked for a PIN it never set.
 */
import { effectivePinHash } from "@/lib/private-zone-pin";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const env = "scrypt$env";
check(
  "a new account with no PIN has no gate",
  effectivePinHash({ hash: null, isDefault: false }, env) === null,
);
check(
  "an account's own PIN gates it",
  effectivePinHash({ hash: "scrypt$own", isDefault: false }, env) === "scrypt$own",
);
check(
  "the owner with no PIN of their own keeps the env PIN",
  effectivePinHash({ hash: null, isDefault: true }, env) === env,
);
check(
  "the owner's own PIN wins over the env",
  effectivePinHash({ hash: "scrypt$own", isDefault: true }, env) === "scrypt$own",
);
check("no env PIN, no gate", effectivePinHash({ hash: " ", isDefault: true }, undefined) === null);
check("an unknown user has no gate", effectivePinHash(null, env) === null);
console.log(`\nprivate-zone-pin: ${passed} passed`);
