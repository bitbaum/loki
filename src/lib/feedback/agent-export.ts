/**
 * A project's feedback reports as ONE text file an agent can read.
 *
 * The agent in a session cannot see Loki's database. Asked to "synthesize
 * user feedback for substrata", it searched its memory folder, the repo and
 * GitHub, found nothing, and asked the person to export the widget's reports
 * by hand — reports Loki already holds (operator, 2026-10-15). This is that
 * export, attached to the message by the person's own choice: they see the
 * file on the box before anything is sent, which is the operator approval the
 * iron rule in lib/feedback/untrusted.ts requires.
 *
 * What goes in: what was said, where, when, how often, and what became of it.
 * What never does: the reporter's contact, browser string or screenshots —
 * the agent needs the words, not the person.
 *
 * Pure: rows in, text out.
 */
import { UNTRUSTED_PREAMBLE, fenceUntrusted, inlineUntrusted } from "@/lib/feedback/untrusted";

/** Stays well under the attachment limit and a paste a session can take. */
export const FEEDBACK_EXPORT_MAX_CHARS = 40_000;

export type FeedbackExportRow = {
  suggestion: string;
  status: string;
  source: string | null;
  page: string | null;
  url: string | null;
  scope: string | null;
  duplicateCount: number;
  createdAt: Date;
};

const SOURCE_WORDS: Record<string, string> = {
  visitor: "a visitor",
  owner: "the owner",
  ai_review: "Loki's review",
  synthesizer: "Loki's summary",
};

export function feedbackFileName(project: string): string {
  const slug = project
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "project"}-feedback.md`;
}

export function formatFeedbackForAgent(
  project: string,
  rows: readonly FeedbackExportRow[],
): { content: string; included: number; total: number } {
  const total = rows.length;
  const header = [
    `# Feedback reports for ${project}`,
    "",
    total === 0
      ? "Loki holds no feedback reports for this project yet."
      : `${total} report${total === 1 ? "" : "s"} from Loki's feedback widget and reviews, newest first. ` +
        '"Said N times" means the same report arrived N times.',
    "",
    UNTRUSTED_PREAMBLE,
  ].join("\n");

  const blocks: string[] = [];
  let length = header.length;
  for (const [i, r] of rows.entries()) {
    const where = r.url || r.page;
    const meta = [
      r.createdAt.toISOString().slice(0, 10),
      `from ${SOURCE_WORDS[r.source ?? ""] ?? "a visitor"}`,
      where ? `on ${inlineUntrusted(where, 200)}` : null,
      r.scope ? `about the ${r.scope}` : null,
      r.duplicateCount > 1 ? `said ${r.duplicateCount} times` : null,
      `status: ${r.status}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const block = `## Report ${i + 1}\n${meta}\n${fenceUntrusted("FEEDBACK", r.suggestion.trim())}`;
    if (length + block.length + 2 > FEEDBACK_EXPORT_MAX_CHARS) break;
    blocks.push(block);
    length += block.length + 2;
  }
  const included = blocks.length;
  const footer =
    included < total
      ? `\n\n(${total - included} older report${total - included === 1 ? "" : "s"} left out to keep this file readable.)`
      : "";
  return { content: [header, ...blocks].join("\n\n") + footer, included, total };
}
