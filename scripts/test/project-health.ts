// Verifies the derived project health score (src/lib/project-health.ts):
// score = count of passing named checks, every miss names its action.
// Run: npx tsx scripts/test/project-health.ts
import { computeProjectHealth, describeProjectHealth } from "@/lib/project-health";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(
      `✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const full = computeProjectHealth({
  description: "A real project brief.",
  gitUrl: "https://github.com/x/y",
  dirPath: null,
  attrs: {
    mission: "Serve users",
    production_url: "https://example.com",
    status: "production",
    next_step: "Ship the thing",
    definition_of_done: "Tests pass and deployed",
  },
});
eq(full.score, 10, "all facts present → 10/10");
eq(full.max, 10, "max is 10");
eq(describeProjectHealth(full), "10/10", "perfect score has no missing list");

const empty = computeProjectHealth({ description: null, attrs: {} });
eq(empty.score, 3, "empty project keeps only the three no-open-issue points");
eq(
  empty.checks.filter((c) => !c.pass).every((c) => c.detail.length > 0),
  true,
  "every miss names its action",
);

// An open attention item costs exactly its point and surfaces in the description.
const risky = computeProjectHealth({
  description: "Brief",
  gitUrl: "https://github.com/x/y",
  attrs: {
    mission: "m",
    production_url: "u",
    status: "production",
    // Not a one-letter placeholder like its neighbours: the done-check now
    // demands a bar a turn can actually evidence, so it needs a real command.
    next_step: "n",
    definition_of_done: "`npm run verify` passes",
    security_vulnerability: "Email verification bypass",
  },
});
eq(risky.score, 9, "one open security risk → 9/10");
eq(
  describeProjectHealth(risky).includes("No security risk"),
  true,
  "missing list names the security check",
);
eq(
  risky.checks.find((c) => c.key === "security_vulnerability")?.detail,
  "Email verification bypass",
  "failing check carries the issue text",
);

// A definition_of_done that describes the finished product is not gradeable:
// the run-grader sees only the handoff, so such a bar downgrades every run to
// `partial` forever. Present must not be mistaken for usable.
const vagueBar = computeProjectHealth({
  description: "Brief",
  gitUrl: "https://github.com/x/y",
  attrs: {
    mission: "m",
    production_url: "u",
    status: "production",
    next_step: "n",
    definition_of_done: "Placement decisions are made with compatibility scores",
  },
});
eq(
  vagueBar.checks.find((c) => c.key === "done")?.pass,
  false,
  "product-description bar fails the done check",
);
eq(
  vagueBar.checks.find((c) => c.key === "done")?.detail.includes("Not checkable"),
  true,
  "failing done check explains why, not just that",
);

// The bulk-import placeholder description does not count as a brief.
const placeholder = computeProjectHealth({
  description: "Local repository imported from loki-ui",
  attrs: {},
});
eq(
  placeholder.checks.find((c) => c.key === "brief")?.pass,
  false,
  "placeholder brief earns no point",
);

// live_url column is the SSOT; attrs are only the fallback.
const fromColumn = computeProjectHealth({
  description: "Brief",
  gitUrl: "https://github.com/x/y",
  liveUrl: "https://app.example",
  attrs: { mission: "m", status: "production", next_step: "n", definition_of_done: "tests pass" },
});
eq(
  fromColumn.checks.find((c) => c.key === "live")?.pass,
  true,
  "live_url column earns the live point",
);

// An imported snapshot is not an open issue, even when the words are a real
// bug. Confirming it means rewriting it in Loki, which changes the source.
const confirmedInput = {
  description: "Brief",
  gitUrl: "https://github.com/x/y",
  attrs: {
    mission: "m",
    production_url: "u",
    status: "production",
    next_step: "n",
    definition_of_done: "`npm run verify` passes",
    security_vulnerability: "Email verification bypass",
  },
  attrMeta: {
    security_vulnerability: {
      updatedAt: "2026-04-01T00:00:00.000Z",
      source: "loki-ui",
      validUntil: null,
    },
  },
};
const imported = computeProjectHealth({
  ...confirmedInput,
  attrMeta: {
    security_vulnerability: {
      updatedAt: "2026-04-01T00:00:00.000Z",
      source: "knowledge.sqlite",
      validUntil: null,
    },
  },
});
eq(imported.score, 10, "an imported security note does not cost the point");
eq(computeProjectHealth(confirmedInput).score, 9, "a note confirmed in Loki still costs the point");

if (fail === 0) console.log(`✓ project-health: ${pass} checks passed`);
else {
  console.error(`${fail} failed`);
  process.exit(1);
}
