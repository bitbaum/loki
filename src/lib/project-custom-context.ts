import { humanizeAttrKey, projectFieldByKey } from "@/config/project-attrs";

/**
 * How many operator-added fields the dossier spells out in full.
 *
 * Every line is paid for on every dispatch of this project, forever, and the
 * prompt still has to carry goals, runtime and the last handoff after it.
 * Twelve is well above what any real profile uses and far below what could
 * crowd the rest out.
 */
export const MAX_CUSTOM_CONTEXT_FIELDS = 12;

export const CUSTOM_CONTEXT_HEADING = "## Additional context (added by the operator)";

/**
 * The lines an agent gets for fields the operator added themselves.
 *
 * The editor these are typed into is headed "Agent context", and until this
 * existed they reached no agent at all: the dossier profile was built from
 * hardcoded property reads (`attrs.mission`, …), so a key nobody had thought
 * of in advance was stored, rendered back to the human, and silently dropped
 * on the way to the model. A field that looks like it works and does nothing
 * is worse than no field.
 *
 * Only UNREGISTERED keys qualify. A registered field already states whether it
 * reaches agents, and two of those answers are deliberately "no" — the market
 * lens is for the human operator, and UI-owned attrs like `business_plan` have
 * their own surface. Consulting the registry is what stops a fallthrough here
 * from quietly undoing those decisions.
 *
 * Lives in lib/ rather than beside the dossier renderer because that module
 * opens a database connection at import time, which put the text of every
 * dispatch beyond the reach of the env-independent unit suite.
 */
export function operatorAddedContextLines(attrs: Record<string, string>): string[] {
  const custom = Object.entries(attrs)
    .filter(([key, value]) => value?.trim() && !projectFieldByKey.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  if (custom.length === 0) return [];

  const lines = [CUSTOM_CONTEXT_HEADING];
  for (const [key, value] of custom.slice(0, MAX_CUSTOM_CONTEXT_FIELDS)) {
    lines.push(`- ${humanizeAttrKey(key)}: ${value}`);
  }

  // Values are never clipped — half a sentence of context is worse than a
  // named absence — so anything past the cap is listed by NAME. That is honest
  // about what was withheld, and lets the agent ask for it.
  const omitted = custom.slice(MAX_CUSTOM_CONTEXT_FIELDS);
  if (omitted.length > 0) {
    lines.push(
      `- (${omitted.length} more field(s) not shown: ${omitted
        .map(([key]) => humanizeAttrKey(key))
        .join(", ")})`,
    );
  }
  return lines;
}
