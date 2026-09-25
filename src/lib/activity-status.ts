// Pure domain helpers for activity status — no DB or React dependencies.
// Importable from tests, from API routes, and from UI without pulling in
// the Postgres pool.
//
// Anything that classifies a run, ranks its severity, or picks a display
// body for a prompt lives here. If you find yourself replicating one of
// these rules anywhere, import from here instead.

import { getIntentLabel } from "@/config/control-intents";
import type { StatusTone } from "@/lib/constants/statuses";
import { EXIT_CONTRACT_PATTERN, ORCH_STATE } from "@/lib/orchestration/contract";

type RunStatusInput = {
  state: string | null;
  outcome: string | null;
  payload: { error?: unknown } | null;
  finishedAt: Date | null;
};

export function isErrorRun(run: RunStatusInput): boolean {
  return run.outcome === "error" || run.state === ORCH_STATE.ERROR || Boolean(run.payload?.error);
}

export function runStatus(run: RunStatusInput): StatusTone {
  if (isErrorRun(run)) return "negative";
  if (run.state === ORCH_STATE.RUNNING && !run.finishedAt) return "warning";
  if (run.outcome === "success") return "positive";
  if (run.outcome === "partial") return "warning";
  return "neutral";
}

type PromptBodyInput = {
  customPrompt: string | null;
  resolvedPrompt: string | null;
  intent: string;
};

export type PromptDisplayFields = {
  customPrompt: string | null;
  resolvedPrompt: string | null;
  displayText: string;
  isCustom: boolean;
};

// Strip harness scaffolding so an activity title shows the human intent, not the
// raw injected machine prompt. Dispatches can capture the fully-assembled prompt
// (context tiers + harness envelopes), which renders as noise like
// "<task-notification><task-id>…" in every activity feed. Only rewrites when a
// harness tag is actually present — clean prompts (and their whitespace) pass
// through verbatim, so existing display semantics are preserved.
const HARNESS_TAG =
  /<\/?(task-notification|system-reminder|command-[a-z-]+|local-command-[a-z-]+)[^>]*>/i;
export function stripHarnessScaffolding(text: string): string {
  if (!HARNESS_TAG.test(text)) return text;
  return (
    text
      // Drop whole paired blocks first (content between open/close tags).
      .replace(
        /<(task-notification|system-reminder|command-[a-z-]+|local-command-[a-z-]+)\b[^>]*>[\s\S]*?<\/\1>/gi,
        " ",
      )
      // Then any stray/self-closing harness tags left behind.
      .replace(HARNESS_TAG, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// The fully-assembled operator dispatch (preamble + engineering standards +
// autopilot ruleset + exit contract, ~2,000 words) is machine plumbing, not a
// human changelog entry. When a stored prompt IS that envelope, rendering it
// verbatim buried the Activity timeline under three full copies of the
// pipeline's guts. Detect it and collapse to the intent label instead.
const OPERATOR_ENVELOPE = /#\s*Loki operator dispatch/i;
export function isOperatorEnvelope(text: string): boolean {
  return OPERATOR_ENVELOPE.test(text.slice(0, 200));
}

// ─── Recovering the human ask from an assembled dispatch ─────────────────────

/**
 * The background blocks the dispatch pipeline (lib/inject-prompt.ts) wraps
 * around the operator's actual task, each with the boundary that ends it.
 *
 * Boundaries are explicit rather than "split on headings" because the intent
 * body is NOT a heading — it starts with a bare "Work on the project at …"
 * line. A naive heading split absorbed it into the preceding context block and
 * threw the task away with the background, which is the opposite of the point.
 *
 * Order matters: the exit contract consumes everything to the end, so it goes
 * first. Each pattern is anchored to a heading this repo actually emits (see
 * OPERATOR_CONTEXT_HEADING, renderEscalationBlock, renderProjectContextBlock);
 * a block that changes upstream stops matching and degrades to "shown, a bit
 * noisy" rather than "task silently swallowed".
 */
const ENVELOPE_BLOCK_PATTERNS: RegExp[] = [
  // Exit contract is always last and runs to the end of the dispatch.
  EXIT_CONTRACT_PATTERN,
  // Preamble: the heading plus its one explanatory paragraph (to a blank line).
  /^#[ \t]*Loki operator dispatch\b[^\n]*(?:\n(?!\s*$)[^\n]*)*/im,
  // Heading-delimited background sections. They end at the next heading, or at
  // the prose-form "Project context & goals" header, whichever comes first.
  /^##[ \t]*The operator['\u2019]s goals & deadlines\b[\s\S]*?(?=\n#{1,3}[ \t]|\nProject context & goals\b|(?![\s\S]))/im,
  /^##[ \t]*Background context from your other projects\b[\s\S]*?(?=\n#{1,3}[ \t]|\nProject context & goals\b|(?![\s\S]))/im,
  // The RAG block. Its heading is "Relevant context…", not "Background
  // context…", so the pattern above never matched it and every dispatch that
  // retrieved anything showed its ask as "## Relevant context from your other
  // projects…" in the Activity feed — the retrieval scaffolding presented as
  // the thing the operator typed. Exactly the upstream-drift this list's own
  // comment warns about; scripts/test/dispatch-headings-stripped.ts now fails
  // when a pipeline heading has no pattern here.
  /^##[ \t]*Relevant context from your other projects\b[\s\S]*?(?=\n#{1,3}[ \t]|\nProject context & goals\b|(?![\s\S]))/im,
  /^##[ \t]*Escalation state\b[\s\S]*?(?=\n#{1,3}[ \t]|\nProject context & goals\b|(?![\s\S]))/im,
  // The project brief block ends with its own sentinel line, not a heading.
  /^Project context & goals\b[\s\S]*?Favor the next step that most advances these goals\.?/im,
];

/** The header the pipeline puts directly above a user-typed custom prompt. */
const TASK_SECTION_RE =
  /^##[ \t]*Your task \(direct operator instruction\)[ \t]*\n([\s\S]*?)(?=\n#{1,3}[ \t]|$)/im;

/**
 * The operator's actual instruction, recovered from a fully-assembled dispatch.
 *
 * The pipeline wraps every dispatch in ~2,000 words of preamble, context blocks
 * and an exit contract. Activity used to respond by hiding the whole thing
 * behind "assembled operator dispatch (… full text hidden)" — which is why the
 * feed could not answer the one question it exists to answer: what did I ask
 * for? The text was never missing, only suppressed.
 *
 * Two recovery paths, in order of confidence:
 *   1. A custom prompt is fenced under an explicit "Your task" header — return
 *      exactly that section.
 *   2. An intent dispatch has no such header; subtract the known background
 *      blocks and return what remains (the rendered intent body).
 *
 * Returns null when nothing recognisable survives, so callers fall back to the
 * intent label rather than printing an empty string.
 */
export function extractOperatorTask(text: string): string | null {
  if (!text.trim()) return null;

  const explicit = text.match(TASK_SECTION_RE);
  if (explicit?.[1]?.trim()) return explicit[1].trim();

  let rest = text;
  for (const pattern of ENVELOPE_BLOCK_PATTERNS) rest = rest.replace(pattern, "\n");
  const body = rest.replace(/\n{3,}/g, "\n\n").trim();
  return body || null;
}

/**
 * What a prompt row should show, as a pair: a short line for the collapsed row
 * and the complete text for the expanded one.
 *
 * `full` is deliberately the ORIGINAL stored text, not the extraction — when
 * someone expands a row they are asking "what exactly was sent", and answering
 * with a cleaned-up paraphrase would be a different (worse) answer.
 */
export type PromptDisplay = {
  /** One-line-ish summary for the collapsed row. Never empty. */
  preview: string;
  /** Complete stored prompt, when there is one worth expanding to. */
  full: string | null;
  /**
   * The operator's instruction, unwrapped and NOT truncated.
   *
   * Distinct from `preview` (shortened for a row) and from `full` (the whole
   * assembled envelope). This is what a re-dispatch must send: replaying
   * `full` would hand the pipeline its own preamble to wrap a second time,
   * and replaying `preview` would silently re-run a truncated instruction.
   */
  task: string | null;
  /** True when `full` holds meaningfully more than `preview`. */
  expandable: boolean;
  /** True when no prompt text was ever recorded (not merely hidden). */
  missing: boolean;
  /**
   * The autopilot loop that injected this, when a loop did — `next_best`,
   * `quality`, `test_and_fix` — else null for a prompt a human actually typed.
   *
   * The feed labels every row "asked:", which is a claim about who asked. For
   * these rows nobody did, and the prompt says so in its own first sentence.
   */
  autopilotLoop: string | null;
};

const PREVIEW_MAX = 240;

function onePreviewLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

/**
 * The header `config/prompt-library.ts` puts on every autopilot template:
 * `[autopilot · loop=next_best — this prompt was auto-injected by the local
 * dispatch loop, NOT typed by a human …]`.
 *
 * It is addressed to the AGENT, and it is ~230 characters — which is the whole
 * 240-character preview budget. Measured on prod 2026-09-20: three consecutive
 * "Needs you" rows whose visible text was this same sentence, cut at
 * "suspect th…". Three different runs, one indistinguishable paragraph, and
 * the reader never reached a word of what was actually asked.
 *
 * Stripped from the PREVIEW only. `task` is what a re-dispatch sends and
 * `full` is what the agent received; removing it there would re-run the loop's
 * work without the instruction that tells the agent a loop sent it.
 */
const AUTOPILOT_PREAMBLE = /\[autopilot\s*·\s*loop=([a-z_]+)\b[^\]]*\]/i;

/** Which loop injected this prompt, or null when a human typed it. */
export function readAutopilotLoop(text: string): string | null {
  return AUTOPILOT_PREAMBLE.exec(text)?.[1] ?? null;
}

/** The same text with the agent-facing header removed, for display. */
export function stripAutopilotPreamble(text: string): string {
  return text
    .replace(AUTOPILOT_PREAMBLE, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The display pair for one prompt row. This is the function the Activity feed
 * uses; `promptDisplayBody` stays as the single-string form other surfaces
 * already consume.
 */
export function promptDisplay(row: PromptBodyInput): PromptDisplay {
  const rawCustom = row.customPrompt ? stripHarnessScaffolding(row.customPrompt) : "";
  const rawResolved = row.resolvedPrompt ? stripHarnessScaffolding(row.resolvedPrompt) : "";

  // A plain custom prompt (no envelope) is already exactly the human ask.
  if (rawCustom && !isOperatorEnvelope(rawCustom)) {
    return {
      // Preview only. `task` and `full` keep the header — see AUTOPILOT_PREAMBLE.
      preview: onePreviewLine(stripAutopilotPreamble(rawCustom)),
      full: rawCustom,
      task: rawCustom,
      expandable: rawCustom.replace(/\s+/g, " ").trim().length > PREVIEW_MAX,
      missing: false,
      autopilotLoop: readAutopilotLoop(rawCustom),
    };
  }

  // Otherwise work from whichever field carries the assembled dispatch.
  const envelope = isOperatorEnvelope(rawCustom) ? rawCustom : rawResolved;
  if (envelope) {
    const recovered = isOperatorEnvelope(envelope) ? extractOperatorTask(envelope) : envelope;
    const preview = recovered
      ? onePreviewLine(stripAutopilotPreamble(recovered))
      : getIntentLabel(row.intent);
    return {
      preview,
      full: envelope,
      task: recovered,
      // The envelope is always worth expanding: it holds the context the agent
      // actually received, which is the whole point of being able to look.
      expandable: true,
      missing: false,
      autopilotLoop: readAutopilotLoop(envelope),
    };
  }

  // Nothing was recorded. Say so rather than printing the intent slug as if it
  // were the prompt — a body reading "custom" is indistinguishable from a bug.
  return {
    preview: "",
    full: null,
    task: null,
    expandable: false,
    missing: true,
    autopilotLoop: null,
  };
}

// The most informative body for a prompt row. Custom text (what the user
// typed) wins; then the rendered intent template (populated for dispatches
// from 2026-06-10 onward); then the intent label so legacy rows still
// render something. Harness scaffolding is stripped so titles stay human;
// if stripping a value leaves nothing, fall through to the next source.
// Used by every surface that displays a prompt.
export function promptDisplayBody(row: PromptBodyInput): string {
  const custom = row.customPrompt ? stripHarnessScaffolding(row.customPrompt) : "";
  if (custom && !isOperatorEnvelope(custom)) return custom;
  const resolved = row.resolvedPrompt ? stripHarnessScaffolding(row.resolvedPrompt) : "";
  if (resolved && !isOperatorEnvelope(resolved)) return resolved;
  const label = getIntentLabel(row.intent);
  // Tag "assembled operator dispatch" ONLY when we actually hid an operator
  // envelope. A legacy row with no prompt text just shows the intent label —
  // it must not claim a ~2,000-word dispatch was hidden when there was none.
  return isOperatorEnvelope(custom) || isOperatorEnvelope(resolved)
    ? `${label} — assembled operator dispatch (brief + goals + autopilot rules; full text hidden)`
    : label;
}

// Strip the harness envelope and collapse to null when nothing human remains.
// Used so the display fields below are display-safe by construction. Mirrors
// stripHarnessScaffolding's own contract: a clean value (no harness tag) passes
// through VERBATIM — surrounding whitespace included — so existing display
// semantics are preserved; only a value that actually carried scaffolding gets
// the strip's whitespace-collapse. Whitespace-only or scaffolding-only → null.
function nonEmptyStripped(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const stripped = stripHarnessScaffolding(text);
  if (!stripped.trim()) return null;
  // Operator envelopes are machine plumbing — treat like scaffolding-only so
  // surfaces that render these fields directly never leak the full dispatch.
  return isOperatorEnvelope(stripped) ? null : stripped;
}

export function toPromptDisplayFields(row: PromptBodyInput): PromptDisplayFields {
  // Display contract: customPrompt/resolvedPrompt are harness-envelope-free, so
  // every surface that renders them directly (Recent Agent Work, history feed)
  // is display-safe without re-stripping. A dispatch that is pure scaffolding —
  // e.g. a <task-notification> completion signal mis-recorded as a custom
  // prompt — strips to empty → null, so isCustom is false and the row falls back
  // to its intent label instead of leaking the raw machine envelope.
  const customPrompt = nonEmptyStripped(row.customPrompt);
  const resolvedPrompt = nonEmptyStripped(row.resolvedPrompt);
  return {
    customPrompt,
    resolvedPrompt,
    displayText: promptDisplayBody({ customPrompt, resolvedPrompt, intent: row.intent }),
    isCustom: Boolean(customPrompt),
  };
}

// Severity ordering for "worst of N events" reductions (status strip etc).
export const STATUS_RANK: Record<StatusTone, number> = {
  negative: 3,
  warning: 2,
  positive: 1,
  neutral: 0,
};
