/**
 * A project field is described in exactly one place.
 *
 * Five lists used to decide what a project field is and does — the context
 * editor's groups, the agent dossier's Profile block, the fallback
 * DRIVING_FIELDS, the AI profile-apply keys, and the public allowlist. Adding
 * one field meant editing five places, and nothing checked they agreed. They
 * had already drifted in ways no one had noticed:
 *
 *   - the dossier carried `status`; DRIVING_FIELDS did not
 *   - the dossier said "Next owner step"; DRIVING_FIELDS said
 *     "Next step (owner's highest-priority action right now)"
 *   - the editor said "People served"; both agent paths said "Customers"
 *
 * All of those lists are now derived from PROJECT_FIELDS. This test pins what
 * they derive to, because the derived values are PROMPT TEXT: a careless edit
 * to the registry silently changes what every agent reads. The expectations
 * below are written out longhand on purpose — if one changes, that belongs in
 * a diff a human reads, not in a refactor.
 *
 * Run: npx tsx scripts/test/one-registry-describes-a-field.ts
 */
import {
  PROJECT_ATTR,
  PROJECT_AI_FILL_KEYS,
  PROJECT_CONTEXT_GROUPS,
  PROJECT_EDITOR_HIDDEN_KEYS,
  PROJECT_DRIVING_FIELDS,
  PROJECT_FIELDS,
  PUBLIC_IDENTITY_ATTRS,
  projectFieldByKey,
} from "@/config/project-attrs";

// Imported from config, not from db/queries/project-context (which re-exports
// it as DRIVING_FIELDS): that module opens a database connection at import
// time, and this suite must pass with no DATABASE_URL.
const DRIVING_FIELDS = PROJECT_DRIVING_FIELDS;

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function same(actual: readonly unknown[], expected: readonly unknown[], what: string) {
  const a = JSON.stringify(actual, null, 1);
  const b = JSON.stringify(expected, null, 1);
  assert(a === b, `${what}\n    actual:   ${a}\n    expected: ${b}`);
}

console.log("one-registry-describes-a-field:");

check("THE POINT: every known attr key is described exactly once", () => {
  const registered = PROJECT_FIELDS.map((f) => f.key);
  const dupes = registered.filter((k, i) => registered.indexOf(k) !== i);
  assert(dupes.length === 0, `described twice: ${dupes.join(", ")}`);

  // Adding a PROJECT_ATTR key without registering it fails here rather than
  // silently producing a field no UI groups and no agent reads.
  const missing = Object.values(PROJECT_ATTR).filter((k) => !projectFieldByKey.has(k));
  assert(missing.length === 0, `in PROJECT_ATTR but not in the registry: ${missing.join(", ")}`);

  const unknown = registered.filter(
    (k) => !(Object.values(PROJECT_ATTR) as string[]).includes(k as string),
  );
  assert(unknown.length === 0, `registered but not a PROJECT_ATTR key: ${unknown.join(", ")}`);
});

check("a field cannot both have an editor group and be editor-hidden", () => {
  const both = PROJECT_FIELDS.filter((f) => f.group !== null && f.editorHidden).map((f) => f.key);
  assert(both.length === 0, `contradictory: ${both.join(", ")}`);
});

check("the context editor still offers the same 10 fields, worded the same", () => {
  same(
    PROJECT_CONTEXT_GROUPS.map((g) => [g.title, g.fields.map((f) => [f.label, f.placeholder])]),
    [
      [
        "Purpose",
        [
          ["Mission", "Why this project exists now"],
          ["Vision", "The future this project should create"],
          ["People served", "Who uses it and what they need"],
        ],
      ],
      [
        "Product",
        [
          ["Problem", "The concrete problem worth solving"],
          ["Solution", "How this project solves the problem"],
        ],
      ],
      [
        "Reach",
        [
          ["Distribution", "Channels that exist today — RSS, newsletter, social queue, OG cards"],
          ["Go-to-market", "ICP, path to first paying customer, monetization state"],
        ],
      ],
      [
        "Build contract",
        [
          ["Stack", "Languages, frameworks, and infrastructure"],
          ["Architecture", "Main modules, stores, and integrations"],
          ["Conventions", "Patterns and rules every agent must follow"],
        ],
      ],
    ],
    "editor groups changed",
  );

  // The project page prints this as "N/N core fields complete". It read 10/10
  // before the registry and must still read 10.
  const fieldCount = PROJECT_CONTEXT_GROUPS.reduce((n, g) => n + g.fields.length, 0);
  assert(fieldCount === 10, `core field count is ${fieldCount}, was 10`);
});

check("the agent dossier reads the same fields, in the same order, under the same labels", () => {
  // The renderer inserts two rows the registry does not own: "Health" (derived,
  // straight after Status) and "Operator notes" (from user_projects, last).
  same(
    PROJECT_FIELDS.filter((f) => f.inAgentDossier).map((f) => f.dossierLabel ?? f.label),
    [
      "Mission",
      "Vision",
      "Customers",
      "Problem",
      "Solution",
      "Distribution",
      "Go-to-market",
      "Status",
      "Stack",
      "Architecture",
      "Conventions",
      "Definition of done",
      "Next owner step",
    ],
    "the dossier Profile block changed",
  );
});

check("DRIVING_FIELDS derives to the same pairs the fallback prompt used", () => {
  same(
    DRIVING_FIELDS.map(([key, label]) => [key, label]),
    [
      ["mission", "Mission"],
      ["vision", "Vision"],
      ["customers", "Customers"],
      ["problem", "Problem"],
      ["solution", "Solution"],
      ["distribution", "Distribution (channels this project reaches people through today)"],
      ["gtm", "Go-to-market (ICP, path to first paying customer, monetization state)"],
      ["stack", "Stack"],
      ["architecture", "Architecture"],
      ["conventions", "Conventions (how this project is built — follow these)"],
      ["definition_of_done", "Definition of done (a change isn't finished until this holds)"],
      // Deliberate: "Next step" used to sit right after Stack here while the
      // dossier printed it last. One registry cannot hold two orders, and the
      // dossier is the path nearly every dispatch takes, so the fallback
      // adopts the dossier's order. The two lists agreeing is the point.
      ["next_step", "Next step (owner's highest-priority action right now)"],
    ],
    "the fallback dispatch prompt changed",
  );

  assert(
    !DRIVING_FIELDS.some(([key]) => key === PROJECT_ATTR.STATUS),
    "status leaked into DRIVING_FIELDS — it is dossier-only, and adding it changes every fallback prompt",
  );
});

check("market-lens fields are never sent to agents", () => {
  const leaked = [
    PROJECT_ATTR.CURRENT_ALTERNATIVES,
    PROJECT_ATTR.COMPETITORS,
    PROJECT_ATTR.COMPLEMENTS_SUBSTITUTES,
    PROJECT_ATTR.PARTNERSHIPS,
    PROJECT_ATTR.POTENTIAL_CUSTOMERS,
    PROJECT_ATTR.EXPANSION_IDEAS,
  ].filter((key) => {
    const field = projectFieldByKey.get(key);
    return field?.inAgentDossier || field?.inDrivingFields;
  });
  assert(
    leaked.length === 0,
    `market lens is for the human operator; sending it costs tokens on every dispatch: ${leaked.join(", ")}`,
  );
});

check("market-lens fields still reach the editor's 'Additional context' block", () => {
  // They have no editor group AND are not editor-hidden — that combination is
  // what makes them fall through to that block. Marking them hidden would make
  // them disappear from the UI entirely.
  for (const key of [PROJECT_ATTR.COMPETITORS, PROJECT_ATTR.PARTNERSHIPS]) {
    const field = projectFieldByKey.get(key);
    assert(field?.group === null, `${key} should have no editor group`);
    assert(field?.editorHidden === false, `${key} must not be editor-hidden — it would vanish`);
  }
});

check("the AI profile-fill still writes exactly the same 19 keys", () => {
  same(
    [...PROJECT_AI_FILL_KEYS].sort(),
    [
      "architecture",
      "competitors",
      "complements_substitutes",
      "conventions",
      "current_alternatives",
      "customers",
      "definition_of_done",
      "distribution",
      "expansion_ideas",
      "gtm",
      "mission",
      "next_step",
      "partnerships",
      "potential_customers",
      "problem",
      "solution",
      "stack",
      "status",
      "vision",
    ],
    "the AI profile-fill key set changed",
  );
});

check("the public allowlist stays an explicit, reviewable four", () => {
  // Deliberately NOT a registry flag. Publishing is a security boundary, and
  // four lines a reviewer can read beat a boolean scattered across 33 entries.
  // The registry link is only that each published key must be a known field.
  same(
    [...PUBLIC_IDENTITY_ATTRS],
    ["problem", "solution", "mission", "vision"],
    "the public allowlist changed — this puts project text on the open internet",
  );
  for (const key of PUBLIC_IDENTITY_ATTRS) {
    assert(projectFieldByKey.has(key), `published key ${key} is not a registered field`);
  }
});

check("attrs a dedicated UI owns are hidden from 'Additional context'", () => {
  for (const key of [
    PROJECT_ATTR.SECURITY_VULNERABILITY,
    PROJECT_ATTR.BROKEN_FEATURES,
    PROJECT_ATTR.DEPLOYMENT_ISSUE,
    PROJECT_ATTR.BUSINESS_PLAN,
    PROJECT_ATTR.NEXT_STEP,
    PROJECT_ATTR.DEFINITION_OF_DONE,
  ]) {
    assert(PROJECT_EDITOR_HIDDEN_KEYS.has(key), `${key} would show up twice in the editor`);
  }
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
