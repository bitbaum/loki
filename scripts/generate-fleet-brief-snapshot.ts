/**
 * Regenerate src/lib/fleet-brief/snapshot.generated.json from bitbaum/fleet.
 *
 * The snapshot is the fleet brief's fallback when GitHub is slow or down at
 * dispatch time. It is produced from the same two producers the live path
 * reads (registers/packages.json and the STACK.md table), through the same
 * parsers, so the fallback and the live brief cannot disagree about shape.
 *
 *   pnpm run generate:fleet-brief                 # from raw GitHub (fleet main)
 *   pnpm run generate:fleet-brief --from ../fleet # from a local fleet checkout
 *
 * scripts/test/fleet-brief-snapshot-fresh.ts fails CI once the snapshot is
 * older than its limit; this is the command that fixes it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FLEET_SOURCES } from "../src/lib/fleet-brief/brief";
import {
  FleetSnapshot,
  LIMITS,
  parsePackagesRegister,
  parseStackTable,
} from "../src/lib/fleet-brief/parse";

const OUT = resolve(import.meta.dirname, "../src/lib/fleet-brief/snapshot.generated.json");

async function readSource(kind: "packages" | "stack", fromDir: string | null): Promise<string> {
  if (fromDir) {
    return readFileSync(
      join(fromDir, kind === "packages" ? "registers/packages.json" : "STACK.md"),
      "utf8",
    );
  }
  const res = await fetch(FLEET_SOURCES[kind], { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${FLEET_SOURCES[kind]}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > LIMITS.bodyBytes) throw new Error(`${FLEET_SOURCES[kind]}: too large`);
  return text;
}

async function main() {
  const fromIdx = process.argv.indexOf("--from");
  const fromDir = fromIdx > 0 ? resolve(process.argv[fromIdx + 1] ?? "") : null;

  const register = parsePackagesRegister(JSON.parse(await readSource("packages", fromDir)));
  if (!register) throw new Error("registers/packages.json did not yield a single valid package");
  const stack = parseStackTable(await readSource("stack", fromDir));
  if (!stack) throw new Error("STACK.md has no usable | Job | Blessed | table");

  const snapshot = FleetSnapshot.parse({
    fetchedAt: new Date().toISOString(),
    registerGeneratedAt: register.generatedAt,
    packages: register.packages,
    stack,
  });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        _generated:
          "by scripts/generate-fleet-brief-snapshot.ts from bitbaum/fleet registers/packages.json + STACK.md. Do not edit by hand: run pnpm run generate:fleet-brief.",
        ...snapshot,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `fleet brief snapshot: ${snapshot.packages.length} packages, ${snapshot.stack.length} stack rows → ${OUT}`,
  );
}

main().catch((err) => {
  console.error(`generate-fleet-brief-snapshot: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
