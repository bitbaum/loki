/** Presentation of agent logs; never changes the bytes sent to an agent. */
import { extractOperatorTask, isOperatorEnvelope, stripAutopilotPreamble } from "./activity-status";
import type { TranscriptItem } from "./claude-transcript";

export function isTranscriptInterruption(text: string): boolean {
  return /^\[Request interrupted by user(?: for tool use)?\]\s*$/i.test(text.trim());
}

export function dispatchMessageDisplay(text: string): { text: string; details: string | null } {
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
  const last = items.at(-1);
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
