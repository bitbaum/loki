/**
 * A field you can add must actually do something.
 *
 * `AddAttrInline` has always let an operator type any key/value onto a project,
 * and `humanizeAttrKey` renders it back under "Additional context" in an editor
 * headed **Agent context**. It reached no agent. The dossier profile was built
 * from hardcoded property reads (`attrs.mission`, `attrs.vision`, …), so a key
 * nobody had anticipated was stored, shown back to the human, and dropped
 * silently on the way to the model.
 *
 * That is the worst kind of defect: the feature looks like it works. Someone
 * fills in "SWOT" or "Suppliers", sees it on the page, and reasonably concludes
 * their agents now know about it.
 *
 * The fix deliberately only covers UNREGISTERED keys. A registered field
 * already declares whether it reaches agents, and two of those answers are
 * deliberately "no" — the market lens is for the human operator (sending it
 * costs tokens on every dispatch), and UI-owned attrs like `business_plan`
 * have their own surface. The tests below exist mostly to stop this path from
 * quietly undoing those two decisions.
 *
 * Run: npx tsx scripts/test/operator-added-fields-reach-agents.ts
 */
import { PROJECT_ATTR } from "@/config/project-attrs";
import {
  CUSTOM_CONTEXT_HEADING,
  MAX_CUSTOM_CONTEXT_FIELDS,
  operatorAddedContextLines,
} from "@/lib/project-custom-context";

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

console.log("operator-added-fields-reach-agents:");

check("THE BUG: a field the operator added now reaches the agent", () => {
  const lines = operatorAddedContextLines({
    swot_analysis: "Strength: only refurbisher with a shop. Threat: donated stock is lumpy.",
  });
  assert(lines[0] === CUSTOM_CONTEXT_HEADING, `no heading: ${JSON.stringify(lines)}`);
  assert(
    lines.some((l) => l.includes("Swot analysis") && l.includes("only refurbisher")),
    `the value never reached the prompt: ${JSON.stringify(lines)}`,
  );
});

check("a healthy profile with no custom fields adds nothing at all", () => {
  // No heading over an empty list: a section that is always present teaches
  // the reader to skip the place real content will appear.
  assert(operatorAddedContextLines({}).length === 0, "empty attrs produced lines");
  assert(
    operatorAddedContextLines({ mission: "m", vision: "v", stack: "TypeScript" }).length === 0,
    "registered fields leaked into the custom block — they are already in Profile",
  );
});

check("blank and whitespace-only values are not sent", () => {
  assert(operatorAddedContextLines({ swot: "" }).length === 0, "empty string was sent");
  assert(operatorAddedContextLines({ swot: "   " }).length === 0, "whitespace was sent");
});

check("THE DECISION IT MUST NOT UNDO: market lens still never reaches agents", () => {
  // These are registered and human-only on purpose. If this path ever treats
  // them as "custom", every dispatch silently grows by six fields.
  const lines = operatorAddedContextLines({
    [PROJECT_ATTR.COMPETITORS]: "Revendo, Digitec",
    [PROJECT_ATTR.PARTNERSHIPS]: "City of Zurich",
    [PROJECT_ATTR.EXPANSION_IDEAS]: "Repair cafés",
    [PROJECT_ATTR.CURRENT_ALTERNATIVES]: "Buying new",
    [PROJECT_ATTR.POTENTIAL_CUSTOMERS]: "Schools",
    [PROJECT_ATTR.COMPLEMENTS_SUBSTITUTES]: "Refurb phones",
  });
  assert(lines.length === 0, `market lens leaked into the prompt: ${JSON.stringify(lines)}`);
});

check("UI-owned attrs stay out — they have their own surface", () => {
  const lines = operatorAddedContextLines({
    [PROJECT_ATTR.BUSINESS_PLAN]: "x".repeat(5000),
    [PROJECT_ATTR.SECURITY_VULNERABILITY]: "Email verification bypass",
    [PROJECT_ATTR.REPO]: "bitbaum/evig",
    [PROJECT_ATTR.MATURITY]: "7",
  });
  assert(lines.length === 0, `UI-owned attrs leaked: ${JSON.stringify(lines)}`);
});

check("the cap bounds the prompt, and names what it withheld", () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < MAX_CUSTOM_CONTEXT_FIELDS + 3; i++) {
    many[`custom_field_${String(i).padStart(2, "0")}`] = `value ${i}`;
  }
  const lines = operatorAddedContextLines(many);
  const shown = lines.filter((l) => l.startsWith("- ") && !l.startsWith("- ("));
  assert(
    shown.length === MAX_CUSTOM_CONTEXT_FIELDS,
    `spelled out ${shown.length}, cap is ${MAX_CUSTOM_CONTEXT_FIELDS}`,
  );

  const note = lines.find((l) => l.startsWith("- ("));
  assert(Boolean(note), "went over the cap and said nothing about it");
  assert(note!.includes("3 more field(s)"), `omission count is wrong: ${note}`);
  // Named, not silently dropped — the agent can ask for what it cannot see.
  assert(note!.includes("Custom field 12"), `omitted fields were not named: ${note}`);
});

check("a long value is passed whole rather than clipped mid-sentence", () => {
  const long = "A".repeat(3000);
  const lines = operatorAddedContextLines({ supplier_terms: long });
  assert(
    lines.some((l) => l.includes(long)),
    "the value was truncated — half a sentence of context is worse than a named absence",
  );
});

check("output order is stable, so an unchanged profile yields an unchanged prompt", () => {
  const a = operatorAddedContextLines({ zebra: "1", alpha: "2", middle: "3" });
  const b = operatorAddedContextLines({ middle: "3", zebra: "1", alpha: "2" });
  assert(JSON.stringify(a) === JSON.stringify(b), "key insertion order changed the prompt");
  assert(a[1].includes("Alpha"), `not sorted: ${JSON.stringify(a)}`);
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
