import { SUMMARY_REQUEST, summaryPrompt } from "@/lib/terminal-summary";

/** Presentation only: model history and retry keep the full saved request. */
export function userMessageDisplay(content: string, meta: Record<string, unknown> | null): string {
  if (
    typeof meta?.displayText === "string" &&
    meta.displayText.trim() &&
    meta.displayText.length <= 240
  ) {
    return meta.displayText.trim();
  }
  // Older terminal summaries predate the saved display label. Recognize the
  // generated contract, not arbitrary long messages or a similar first line.
  const generated = /^What's going on with ([^\n]+)\? /.exec(content);
  if (generated && content.startsWith(summaryPrompt(generated[1]))) return SUMMARY_REQUEST;
  return content;
}
