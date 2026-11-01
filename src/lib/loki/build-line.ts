/**
 * The bold next-build line, held back when nobody asked for one.
 *
 * Both system prompts tell Loki to end with a ready-to-send build line
 * (**<project>: <task>**) when the operator is deciding what to do. Smaller
 * fallback models read "when" as "always", so "What was our spending last
 * week?" came back with a build command under the number. The prompt cannot
 * be made reliable on a model that does not listen; this guard does not
 * depend on it listening. Agreed in the 2026-10-31 dogfooding round: strip the
 * line unless the person's own message asked for direction, and hand it to
 * the UI apart from the answer, as a suggestion rather than a conclusion.
 */
import { BUILD_CUES } from "@/lib/agent/cues";
import { isBareConfirmation, offeredCommand } from "@/lib/loki/confirmation";

/**
 * Words that make a build line the answer rather than an aside: the
 * BUILD_CUES the retrieval plan already keys on, plus the plainer shapes
 * ("next", "build", "propose", "decide") and a bare "yes" to a previous offer.
 */
const DIRECTION_CUES =
  /\b(next|build|ship|propos(?:e|al)|decid(?:e|ing)|decision|prioriti[sz]e|priority|recommend|roadmap|plan|focus|what (?:should|shall|do) (?:i|we)|where (?:do|should) (?:i|we)|idea)\w*/i;

export function askedForBuild(message: string | null | undefined): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;
  return BUILD_CUES.test(text) || DIRECTION_CUES.test(text) || isBareConfirmation(text);
}

export type HeldBuildLine = {
  /** The answer, without the line when it was not asked for. */
  text: string;
  /** The line that was held back, bare (no asterisks), or null when none was. */
  buildLine: string | null;
};

/**
 * `answer` as it should reach the person who wrote `asked`. An answer that
 * ends with exactly one command-shaped bold line keeps it when the message
 * asked for direction; otherwise the line comes off the end and is returned
 * apart. Two offered lines, bold inside a sentence, or a person-only step are
 * not build lines (see offeredCommand) and the answer is left as it is.
 */
export function holdBuildLine(answer: string, asked: string | null | undefined): HeldBuildLine {
  const line = offeredCommand(answer);
  if (!line || askedForBuild(asked)) return { text: answer, buildLine: null };
  const lines = answer.split(/\r?\n/);
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i < 0) return { text: answer, buildLine: null };
  lines.splice(i);
  // A lead-in that introduced the line ("Next build:", "Suggested next step:")
  // would be left pointing at nothing.
  let j = lines.length - 1;
  while (j >= 0 && !lines[j].trim()) j--;
  if (
    j >= 0 &&
    /^(?:\*\*)?(?:next (?:build|step)|suggested (?:next )?(?:build|step)|to start(?: it)?|ready to send)\s*:?(?:\*\*)?:?\s*$/i.test(
      lines[j].trim(),
    )
  ) {
    lines.splice(j);
  }
  return { text: lines.join("\n").trimEnd(), buildLine: line };
}

/** The held line as a response body or a stored message's meta carries it. */
export function readBuildLine(meta: Record<string, unknown> | null | undefined): string | null {
  const raw = meta?.buildLine;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}
