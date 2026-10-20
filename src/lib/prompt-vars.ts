/**
 * `{{variable}}` placeholders in prompt bodies — the ONE parser and the ONE
 * renderer, importable from server and client alike.
 *
 * WHY THIS FILE EXISTS
 *
 * The machinery was already written, in `src/db/queries/prompts.ts`, and the UI
 * could not reach it: that module imports `db`, so a client component cannot.
 * Four call sites therefore each rolled their own single-variable substitution:
 *
 *   RunModal              template.replaceAll("{{project_name}}", name)
 *   ScheduleModal         template.replaceAll("{{project_name}}", name)
 *   PromptPicker          substituteProjectName()  (config/prompt-library.ts)
 *   ProjectPromptLibrary  substituteProjectName()
 *
 * All four handle exactly one variable and no defaults. That is fine for the
 * built-in library, whose 37 placeholders are all `{{project_name}}` — and
 * wrong for user-owned prompts, which reach the SAME modals through
 * `asTemplate()` in UserPromptsSection and may declare anything. A prompt body
 * with `{{ticket_id}}` or `{{branch|main}}` was dispatched to the agent with
 * the braces still in it, while `prompts.variables` — the column that exists to
 * hold those declarations — was populated and read by nobody.
 *
 * So: parse and render live here, with no DB import. `db/queries/prompts.ts`
 * re-exports them so server callers keep their import path.
 */

/**
 * `{{name}}` or `{{name|default}}`, tolerant of inner whitespace.
 *
 * Not module-level shared state: a /g regex carries `lastIndex` between calls,
 * so two functions using one instance interfere. Each caller builds its own.
 */
function varRe(): RegExp {
  return /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\|\s*([^}]+))?\s*\}\}/g;
}

export interface PromptVariable {
  name: string;
  defaultValue?: string;
  description?: string;
}

/** Extract the placeholders a body declares. Dedupes by name (first occurrence
 *  wins for the default). Pure — no DB, no I/O. */
export function parsePromptVariables(body: string): PromptVariable[] {
  const seen = new Map<string, PromptVariable>();
  const re = varRe();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    const defaultValue = match[2]?.trim();
    seen.set(name, defaultValue ? { name, defaultValue } : { name });
  }
  return Array.from(seen.values());
}

/**
 * Render a body with substitutions. A supplied value wins; otherwise the
 * declared default; otherwise the placeholder STAYS IN, on purpose — an
 * unfilled `{{ticket_id}}` reaching the agent is visible and answerable, where
 * silently blanking it produces a confident instruction with a hole in it.
 */
export function renderPromptBody(body: string, values: Record<string, string>): string {
  return body.replace(varRe(), (full, name: string, defaultValue?: string) => {
    if (values[name] !== undefined) return values[name];
    if (defaultValue !== undefined) return defaultValue.trim();
    return full;
  });
}

/** The variables a body still needs from a human: declared, no default, and no
 *  value supplied yet. Drives the inputs the run/schedule modals render. */
export function unresolvedVariables(
  body: string,
  values: Record<string, string>,
): PromptVariable[] {
  return parsePromptVariables(body).filter(
    (v) => values[v.name] === undefined && v.defaultValue === undefined,
  );
}

/**
 * Does this prompt need a project before it can be shown or run?
 *
 * Scope alone said no for a saved copy of "Next Best Step": a copy is always
 * saved as global (use-fork-prompt), so the Run dialog hid the project picker
 * and showed "{{project_name}}" in the resolved prompt with nothing to fill it
 * (owner, 2026-10-20). A body that names {{project_name}} needs one whatever
 * its scope says.
 */
export function needsProject(template: { scope: string; template: string }): boolean {
  return (
    template.scope === "project" ||
    parsePromptVariables(template.template).some((v) => v.name === "project_name")
  );
}
