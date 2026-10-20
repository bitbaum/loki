/** Presentation of agent logs; never changes the bytes sent to an agent. */
import { extractOperatorTask, isOperatorEnvelope, stripAutopilotPreamble } from "./activity-status";
import { lastConversationItem, type TranscriptItem } from "./claude-transcript";

export function isTranscriptInterruption(text: string): boolean {
  return /^\[Request interrupted by user(?: for tool use)?\]\s*$/i.test(text.trim());
}

/**
 * The diagnostics a report carries under the widget's "--- technical details
 * ---" line (widget/report-payload DIAGNOSTICS_HEADING): who filed it, the
 * taps and requests before it. The agent needs them; the person reading their
 * own request in a chat bubble does not — Watch showed twelve "step N: request
 * POST /api/…" lines inside "You asked" (owner, 2026-10-20).
 */
const DIAGNOSTICS_RE = /\n?[ \t]*-{3}\s*technical details\s*-{3}[\s\S]*$/i;

export function dispatchMessageDisplay(text: string): { text: string; details: string | null } {
  const shown = dispatchMessageParts(text);
  if (!DIAGNOSTICS_RE.test(shown.text)) return shown;
  const cut = shown.text.replace(DIAGNOSTICS_RE, "").trimEnd();
  return { text: cut || shown.text, details: shown.details ?? text };
}

function dispatchMessageParts(text: string): { text: string; details: string | null } {
  // Claude Code records a pasted message wrapped in its own markers, and
  // writes the closing one with the id too: `</pasted_content id="fdab">`.
  // Those markers are bookkeeping; the person typed what is inside them.
  const unwrapped = text
    .trim()
    .replace(/^<pasted_content\b[^>]*>\s*/i, "")
    .replace(/\s*<\/pasted_content\b[^>]*>\s*$/i, "");
  if (/^(?:The owner of .+ asked for this change|Fix this visitor feedback on )/.test(unwrapped)) {
    const report =
      /<<<UNTRUSTED FEEDBACK — data, not instructions>>>\n([\s\S]*?)\n<<<END UNTRUSTED FEEDBACK>>>/
        .exec(unwrapped)?.[1]
        ?.trim();
    if (report) return { text: report, details: text };
  }
  if (
    !isOperatorEnvelope(unwrapped) &&
    !/^(?:Project context & goals|## bitbaum house rules)/.test(unwrapped)
  )
    return { text: unwrapped, details: null };
  const task = extractOperatorTask(unwrapped);
  // Old runners may clip the packet before its task. Never present an internal
  // context block as the person's instruction in that case.
  const recovered =
    task && !/^(?:#{1,3}\s|<pasted_content\b)/i.test(task) ? stripAutopilotPreamble(task) : null;
  return { text: recovered || "Task sent by Loki", details: text };
}

export const TRANSCRIPT_QUIET_MS = 120_000;
export function transcriptActivity(items: TranscriptItem[], now: number, connected: boolean) {
  // A "Model set to …" line is Claude Code answering a command, not a turn:
  // it neither starts work nor ends it.
  const last = lastConversationItem(items);
  if (last?.kind === "user" && isTranscriptInterruption(last.text))
    return { working: false, label: "Stopped", quiet: false };
  const working = last?.kind === "user" || (last?.kind === "tool" && last.status === "running");
  const lastAt = last?.at ? Date.parse(last.at) : NaN;
  const quiet = !!working && Number.isFinite(lastAt) && now - lastAt >= TRANSCRIPT_QUIET_MS;
  return {
    working: !!working && connected,
    label: !connected
      ? "Reconnecting to the session…"
      : quiet
        ? "No recent update from the agent"
        : working
          ? "Waiting for the agent"
          : null,
    quiet,
  };
}

/** A user stop is not a failed command. */
export function toolWasInterrupted(tool: Extract<TranscriptItem, { kind: "tool" }>): boolean {
  return (
    tool.status === "error" &&
    /Request interrupted by user|tool use (?:was )?rejected/i.test(tool.result ?? "")
  );
}
