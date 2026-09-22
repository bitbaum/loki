/**
 * A number written into prose must match the structure it describes.
 * Run: npx tsx scripts/test/documented-counts.ts
 *
 * The class this closes: someone writes "all 11 sections" next to an array of
 * 11 things. The array grows to 12. The sentence does not, because nothing on
 * earth is watching it — not tsc, not eslint, not any test. The prose is now
 * wrong and will stay wrong, and the next person to read it is misinformed by
 * a file that looks authoritative because it sits beside the code.
 *
 * Measured on 2026-09-22, every one of these was already stale:
 *
 *   "all 11 sections"          SettingsTabs.tsx     TABS has 12
 *   "twenty-three keycaps"     terminal-keys.ts     the groups hold 24
 *   "three run hourly"         telemetry-paths.ts   5 hourly timers installed
 *   "the 1845-line globals"    branding-design.md   6073 lines
 *   ">90s old"                 ProjectCard.tsx      threshold is ~8 min
 *
 * Four of those were fixed by hand in the same sweep that added this file —
 * which is the reason the file exists. Hand-fixing the fifth would have been
 * the fourth time in one day, and a number that has gone stale once will go
 * stale again the moment the structure moves.
 *
 * WHAT BELONGS HERE: a count that is DERIVABLE from this repo. Add the claim,
 * the file, and how to compute the truth.
 *
 * WHAT DOES NOT: a number no source here can settle — the box being a CX33,
 * an artifact's size in MB, a model's download size. Those cannot be gated, so
 * they should not be written down at all. The sweep deleted several rather
 * than restate them, and that is the right instinct: an unverifiable number in
 * prose is a claim with no owner.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  "twenty-three": 23,
  "twenty-four": 24,
};

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** The number a sentence claims — digits or the words we actually use. */
function stated(path: string, pattern: RegExp): number {
  const m = read(path).match(pattern);
  assert.ok(
    m,
    `${path}: the documented-count pattern ${pattern} matched nothing.
This gate is pinned to a sentence. If the wording changed, update the pattern
here in the same commit — a check that silently stops matching is worse than
no check, because it reports success forever.`,
  );
  const raw = m![1]!.toLowerCase();
  const n = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw];
  assert.ok(n !== undefined, `${path}: could not read "${raw}" as a number — add it to WORDS.`);
  return n!;
}

type Check = { what: string; file: string; pattern: RegExp; live: () => number };

const CHECKS: Check[] = [
  {
    what: "settings sections",
    file: "src/components/settings/SettingsTabs.tsx",
    pattern: /all (\d+|[a-z-]+) sections/i,
    live: () => (read("src/components/settings/SettingsTabs.tsx").match(/\{ id: "/g) ?? []).length,
  },
  {
    what: "terminal keycaps",
    file: "src/config/terminal-keys.ts",
    pattern: /flat run of ([a-z-]+|\d+) keycaps/i,
    live: () => {
      const src = read("src/config/terminal-keys.ts");
      const block = src.match(/TERMINAL_SECONDARY_GROUPS[\s\S]*?\n\];/)?.[0] ?? "";
      // every group is `keys: ["a", "b", ...]` — count the entries, not the groups
      return [...block.matchAll(/keys: \[([^\]]*)\]/g)].reduce(
        (n, m) => n + (m[1]!.match(/"/g) ?? []).length / 2,
        0,
      );
    },
  },
  {
    what: "hourly cron timers",
    file: "src/config/telemetry-paths.ts",
    pattern: /logDebug\(\) — (\d+|[a-z-]+) run hourly/i,
    live: () => (read("scripts/install-hetzner-crons.sh").match(/"\*:\d+"/g) ?? []).length,
  },
];

const failures: string[] = [];
for (const c of CHECKS) {
  const said = stated(c.file, c.pattern);
  const truth = c.live();
  if (said !== truth) {
    failures.push(`  ${c.file}\n    says ${said} ${c.what}, but there are ${truth}`);
  }
}

assert.equal(
  failures.length,
  0,
  `${failures.length} documented count(s) no longer match the code:\n\n` +
    failures.join("\n") +
    `\n\nFix the sentence, not this gate — unless the structure is what changed` +
    ` wrongly.\n`,
);

console.log(`✓ documented counts: ${CHECKS.length} claim(s) match their source`);
