/**
 * General questions get general answers — the verifier stops deleting them.
 *
 * Live, 2026-10-17: "What year was the Eiffel Tower built?" → "Not in your
 * data." The closed-world check flagged "Eiffel" and "1889", the repair pass
 * deleted them, and the refusal (zero violations) won. These checks pin that a
 * general answer survives while an invented claim about a record still does not.
 *
 * Pure: no model, no database.
 */
import { makeFact, assignFactIds, verifyAnswer } from "@bitbaum/ai-kit/grounding";
import { isGeneralQuestion, operatorClaims, recordNames } from "@/lib/agent/general-knowledge";
import { JUDGMENT_RULES } from "@/lib/agent/grounded-context";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const facts = assignFactIds([
  makeFact({
    kind: "person",
    subject: "Elena Druzhnikova",
    source: "people table",
    values: { name: "Elena Druzhnikova", notes: "met at the market" },
  }),
  makeFact({
    kind: "project",
    subject: "prodtest-bakery",
    source: "projects table",
    values: { name: "prodtest-bakery", status: "active" },
  }),
]);

function violationsFor(answer: string, message: string) {
  return verifyAnswer({
    answer: operatorClaims(answer, facts, message),
    facts,
    userMessage: message,
  }).violations;
}

// The live failure.
const eiffelQ = "What year was the Eiffel Tower built?";
const eiffelA = "The Eiffel Tower was finished in 1889, for the World's Fair in Paris.";
check(
  "the closed-world check alone flags the general answer (the bug)",
  verifyAnswer({ answer: eiffelA, facts, userMessage: eiffelQ }).violations.length > 0,
);
check(
  "a general answer to a general question passes",
  violationsFor(eiffelA, eiffelQ).length === 0,
);

const gmbhQ = "What's the difference between a sole proprietorship and a GmbH in Switzerland?";
const gmbhA =
  "A sole proprietorship is you trading in your own name: no minimum capital, and you are liable with everything you own. A GmbH is a company of its own with at least CHF 20000 of capital, entered in the Commercial Register, and its owners are liable only for that capital.";
check(
  "Swiss business forms answered from general knowledge pass",
  violationsFor(gmbhA, gmbhQ).length === 0,
);

// A sentence that is about a record is still checked, even on a broad turn.
const mixed =
  "The Eiffel Tower was finished in 1889. Elena Druzhnikova works at the University of Zurich.";
const v = violationsFor(mixed, eiffelQ);
check(
  "an invented claim about a person in the records is still caught",
  v.some((x) => /University|Zurich/.test(x.text)),
);
check(
  "…while the general sentence beside it is left alone",
  !v.some((x) => /Eiffel|1889/.test(x.text)),
);

const cited = "Your bakery is live at bakery.example.ch [F2].";
check(
  "a sentence that cites a record is checked",
  operatorClaims(cited, facts, eiffelQ).includes("bakery.example.ch"),
);

// A question that names a subject keeps the full closed-world check.
const peopleQ = "Who is Elena?";
check(
  "a question about people is verified in full",
  operatorClaims("Elena works at UZH. Paris is lovely.", facts, peopleQ) ===
    "Elena works at UZH. Paris is lovely.",
);

check("a knowledge-cue question about the world is general", isGeneralQuestion(gmbhQ));
check(
  "…but one about the operator's own decisions is not",
  !isGeneralQuestion("Why did I decide to use Stripe?"),
);
check("…nor one about their app", !isGeneralQuestion("Explain the architecture of the app"));
check(
  "record names come from subjects",
  recordNames(facts).has("elena") && recordNames(facts).has("bakery"),
);
check(
  "generic subject words are not names",
  !recordNames([{ subject: "fleet status right now" }]).size,
);

// The prompt says it too — a verifier that allows the answer is no use if the
// contract still tells the model to refuse.
check(
  "the contract carries the general-knowledge rule",
  /11\. .*general knowledge/.test(JUDGMENT_RULES),
);
check(
  "…and says the refusal is never the answer to a general question",
  /never the answer to a general question/.test(JUDGMENT_RULES),
);

console.log(`\ngeneral-knowledge: ${passed} checks passed`);
