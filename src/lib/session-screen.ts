import { stripReportResidue } from "@/lib/terminal-reports";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/** How much of a session's output one read returns: the end of it. */
export const SESSION_READ_MAX_CHARS = 6000;

/**
 * A session's terminal output as text a model can read: escape sequences
 * removed, redrawn lines collapsed, the END kept (what the agent said last is
 * what a reader wants). It is the terminal's output, not a parsed
 * conversation: a full-screen agent redraws, so lines can repeat.
 */
export function plainSessionText(raw: string, maxChars = SESSION_READ_MAX_CHARS): string {
  const lines = stripReportResidue(raw)
    .replace(ANSI_RE, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    // A carriage return redraws the line: the last write is what shows.
    .map((line) =>
      (line.split("\r").pop() ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trimEnd(),
    );
  const out: string[] = [];
  for (const line of lines) {
    // Runs of blank lines and an identical line drawn twice in a row say nothing.
    if (line === out[out.length - 1]) continue;
    out.push(line);
  }
  const text = out.join("\n").trim();
  return text.length > maxChars ? `…${text.slice(text.length - maxChars + 1)}` : text;
}
