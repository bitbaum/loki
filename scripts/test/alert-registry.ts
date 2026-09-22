/**
 * Inline self-test: an alert type must not outlive the code that raises it.
 *
 * THE FAULT THIS LOCKS DOWN
 * -------------------------
 * Measured in production 2026-08-26: ten alerts open, and **four were zombies**
 * — `bill_due`, `stale_relationship`, `overdue_commitment`, `stalled_goal` —
 * raised between 2026-05-10 and 2026-06-23 by features that no longer exist.
 * Nothing could refresh them, nothing could auto-resolve them, and the `alerts`
 * table records no "last confirmed" timestamp, so a live alarm and a 108-day-old
 * fossil are indistinguishable from the row alone.
 *
 * Forty per cent of the surface was permanent noise. That matters because the
 * rational response to a list that is mostly wrong is to stop reading it — and
 * queued underneath those fossils were "a telemetry sensor has been dead for 77
 * days" and "a machine is running a runner we replaced". A channel degrades to
 * the reliability of its worst entry.
 *
 * BOTH DIRECTIONS, AND THE SECOND ONE IS THE POINT
 * -----------------------------------------------
 *   producer ⊆ registry — nothing raises an alert this codebase cannot name.
 *   registry ⊆ producer — every registered type still has code that raises it.
 *
 * The second is what makes retiring a feature loud: delete the producer and CI
 * goes red until the alert type is retired with it, at which point
 * `sweep-orphan-alerts` clears the rows it left behind. Without it the registry
 * becomes another hand-maintained list that rots exactly like the thing it
 * documents.
 *
 * Run: npx tsx scripts/test/alert-registry.ts
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath, join } from "node:path";
import { ALERT_TYPES, ALERT_TYPE_IDS, isRegisteredAlertType } from "@/config/alert-types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(here, "../..");

/** Source with comments removed — a rule must never be satisfied by the prose
 *  that explains it. (Learned twice today: a CI gate matched `fetch-depth: 0`
 *  inside its own justification, and a husky check matched a counter-example
 *  it quoted.) */
function codeOf(absPath: string): string {
  return readFileSync(absPath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// ── The zombies must stay unregistered ─────────────────────────────────────

for (const dead of ["bill_due", "stale_relationship", "overdue_commitment", "stalled_goal"]) {
  assert(
    !isRegisteredAlertType(dead),
    `"${dead}" is registered again, but nothing raises it — it was one of the four ` +
      `types found open in production with no producer. Registering it would exempt ` +
      `those rows from the sweep and put the fossils back on the surface.`,
  );
}

// ── registry ⊆ producer: a registered type must still be raised somewhere ───

for (const [id, spec] of Object.entries(ALERT_TYPES)) {
  const producer = resolvePath(repoRoot, spec.producer);
  assert(
    existsSync(producer),
    `alert type "${id}" names producer ${spec.producer}, which does not exist. ` +
      `If that feature was retired, remove the type from ALERT_TYPES — ` +
      `sweep-orphan-alerts then clears the rows it left behind. Leaving the entry ` +
      `is how bill_due sat open for 108 days.`,
  );
  assert(
    codeOf(producer).includes(`"${id}"`),
    `alert type "${id}" is registered to ${spec.producer}, but that file no ` +
      `longer contains the literal — so nothing raises it and any open rows are ` +
      `unrefreshable fossils. Retire the type, or point it at its real producer. ` +
      `(Comments are stripped before this check, so documenting the id does not ` +
      `count as raising it.)`,
  );
}

// ── producer ⊆ registry: nothing raises a type the codebase cannot name ─────

const RAISERS = /insertActiveAlertOnce\(|refreshOrInsertActiveAlert\(/;
const srcFiles = walk(resolvePath(repoRoot, "src"));
let raiseSites = 0;

for (const file of srcFiles) {
  if (file.endsWith("src/db/queries/alerts.ts")) continue; // the helpers themselves
  const code = codeOf(file);
  if (!RAISERS.test(code)) continue;
  raiseSites += 1;

  const literals = new Set<string>();
  // `type:` must be a key of its own, not the tail of one. Without the
  // preceding boundary this also matched `grant_type: "refresh_token"` in the
  // OAuth refresh beside a raise site, and reported "refresh_token" as an
  // unregistered alert type — a true-looking failure about a line that has
  // nothing to do with alerts, on a file whose only crime was raising one.
  for (const m of code.matchAll(/(?:ALERT_TYPE\s*=\s*|(?<![A-Za-z0-9_])type:\s*)"([a-z_]+)"/g)) {
    literals.add(m[1]);
  }
  assert(
    literals.size > 0,
    `${file.replace(repoRoot + "/", "")} raises an alert but no type literal could ` +
      `be read from it — this check would silently skip the file, which is how an ` +
      `unregistered type gets in.`,
  );
  for (const literal of literals) {
    assert(
      isRegisteredAlertType(literal),
      `${file.replace(repoRoot + "/", "")} raises alert type "${literal}", which is ` +
        `not in ALERT_TYPES. Unregistered types are swept as orphans, so this alarm ` +
        `would be cleared the morning after it first fires.`,
    );
  }
}

// The scan is only meaningful if it found the raise sites at all — a regex that
// matches nothing passes every assertion above it.
assert(
  raiseSites >= 5,
  `only ${raiseSites} alert raise-site(s) found; expected at least 5. The scan ` +
    `has stopped seeing the code it is supposed to police, so its silence means ` +
    `nothing.`,
);

// ── The sweep must clear only UNREGISTERED types ───────────────────────────

const alertsQueries = codeOf(resolvePath(repoRoot, "src/db/queries/alerts.ts"));

/** Just one exported function's body. Scanning the whole file let a SIBLING
 *  satisfy the assertion: `eq(alerts.dismissed, false)` appears in
 *  insertActiveAlertOnce and dismissActiveAlertsByType too, so removing it from
 *  the sweep left this check green. Same scope blind spot that let a CI gate
 *  read a neighbouring job's setting as its own. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const rest = source.slice(start + 1);
  const end = rest.search(/^export /m);
  return end === -1 ? rest : rest.slice(0, end);
}

const sweepBody = fnBody(alertsQueries, "dismissUnregisteredAlerts");
assert(
  sweepBody.length > 0,
  "src/db/queries/alerts.ts no longer exports dismissUnregisteredAlerts — the " +
    "orphan sweep has no implementation to run.",
);
assert(
  /notInArray\(\s*alerts\.type\s*,\s*ALERT_TYPE_IDS\s*\)/.test(sweepBody),
  "dismissUnregisteredAlerts must clear only types absent from ALERT_TYPE_IDS. " +
    "Anything broader would auto-dismiss live alarms, which is far worse than the " +
    "noise it is cleaning up.",
);
assert(
  /eq\(alerts\.dismissed,\s*false\)/.test(sweepBody),
  "the sweep must touch only OPEN alerts — rewriting dismissed history would " +
    "destroy the record of what was once true.",
);

// ── And it must actually be scheduled ──────────────────────────────────────

const sweepRoute = resolvePath(repoRoot, "src/app/api/crons/sweep-orphan-alerts/route.ts");
assert(
  existsSync(sweepRoute) && /dismissUnregisteredAlerts\s*\(/.test(codeOf(sweepRoute)),
  "sweep-orphan-alerts must exist and CALL the sweep — a mention is not a use.",
);

const sched = readFileSync(resolvePath(repoRoot, "scripts/install-hetzner-crons.sh"), "utf8");
assert(
  /\[sweep-orphan-alerts\]="\d\d:\d\d"/.test(sched),
  "sweep-orphan-alerts must be in the SCHED table of install-hetzner-crons.sh. " +
    "An API route with no timer is a janitor nobody calls.",
);

console.log(
  `✓ alert registry: ${ALERT_TYPE_IDS.length} types, all with live producers; ` +
    `${raiseSites} raise sites, all registered`,
);
