/**
 * The grounding contract, plus the clause it was missing: you are allowed to
 * think.
 *
 * ── The bug this exists to end ───────────────────────────────────────────────
 * Asked "what do you think about heidi", Loki replied:
 *
 *     An opinion or assessment is: Not in your data.
 *
 * …and then listed every record whose text contained "Heidi", including two
 * unrelated people who happen to be named Heidi.
 *
 * It was obeying the contract exactly. `buildContract` says (1) every claim
 * about the operator MUST cite a record id, and (3) if any part of the request
 * has no supporting record, answer that part with exactly "Not in your data."
 * An opinion is not a record. So the model looked one up, failed to find it,
 * and refused — a category error the contract made mandatory.
 *
 * ── Why the shared package is not wrong, only incomplete ─────────────────────
 * ai-kit's OTHER contract builder, `buildAssistantRules` (the prose variant
 * Cat uses), already carries the equivalent carve-out as its rule 5: general
 * knowledge "is fine to use and is not covered by rules 1–2. The restriction is
 * on facts about THIS user." The typed-record builder never grew one. So the
 * WEAKER contract is the usable one and the stronger contract forbids
 * reasoning — an asymmetry inside one file.
 *
 * The durable fix belongs upstream in `buildContract`. It is amended here
 * because ai-kit is a shared package with another consumer (OrangeCat) and an
 * active branch, and Loki's chat is broken now. When the rule lands
 * upstream, delete this file and call `buildGroundedContext` directly.
 *
 * ── Why appending is safe ────────────────────────────────────────────────────
 * The clause is inserted at the END of the contract section rather than after
 * the records, because the contract opens with "this overrides every formatting
 * instruction below" — a narrowing placed below that line would be outranked by
 * the thing it is narrowing.
 */
import { buildGroundedContext, type Directive, type Fact } from "@bitbaum/ai-kit/grounding";

/** The separator `buildGroundedContext` joins its sections with. */
const SECTION_SEP = "\n\n---\n\n";

/**
 * Rules 7–11, continuing the contract's own numbering.
 *
 * Written as a NARROWING of rules 1–6, never a contradiction: every factual
 * claim inside an assessment is still bound by them. What changes is that
 * "what do you think" stops being treated as a lookup that can fail.
 */
export const JUDGMENT_RULES = [
  `7. "${"Not in your data."}" is about missing FACTS. It is never the answer to a request for JUDGMENT. If the operator asks what you think, for an assessment, a comparison, a recommendation, a risk, or a "should I" — produce one. An opinion is not a record to be looked up; it is what you build FROM the records. Replying that an opinion is not in the data is a category error, not caution.`,
  '8. Ground the judgment and show its footing: give the assessment, then the records it rests on. Thin evidence earns a hedge — "only two runs are recorded, so this is weak" — never a refusal. Saying what the records DO and DO NOT support is itself the answer.',
  "9. A record that matched only because a NAME contains the operator's search word may have nothing to do with the subject. A person sharing a name with a project is not evidence about that project. Do not pad an answer with such rows as though they were relevant; omit them, or say plainly that they merely share a name.",
  "10. Rules 1–6 still bind every FACTUAL claim you make inside an assessment. The licence here is to reason over the records, never to invent one.",
  `11. Rules 1–6 are about the OPERATOR — their projects, people, plans and history. A question about the world (a definition, how something works, a date in history, how a law or a business form works in general, a rule of thumb, how to do something) is answered from general knowledge, directly and correctly, with no citation — even when no records were retrieved. "${"Not in your data."}" is never the answer to a general question. Do not add a paragraph saying the records do not cover it; when general advice meets their own records, say in a few words which part comes from where.`,
].join("\n");

/**
 * Build the grounded context for a Loki turn.
 *
 * SSOT for both paths that ground a turn — the in-app tool loop and the
 * gateway fallback. They had no shared assembly point, so the production
 * refusal came through the gateway while the loop carried the same defect
 * untested. One function means neither can drift from the other.
 */
export function buildLokiContext(input: {
  facts: Fact[];
  directives: Directive[];
  renderedFacts: string;
}): string {
  const grounded = buildGroundedContext(input);
  const cut = grounded.indexOf(SECTION_SEP);
  // No separator means the shape changed upstream. Append rather than throw:
  // a slightly worse-placed rule is a far better failure than a turn with no
  // contract at all.
  if (cut === -1) return `${grounded}\n${JUDGMENT_RULES}`;
  return `${grounded.slice(0, cut)}\n${JUDGMENT_RULES}${grounded.slice(cut)}`;
}
