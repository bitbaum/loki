import { createHash } from "node:crypto";

/**
 * Ingest dedupe key: sha256 over normalized suggestion + page. Normalization
 * (lowercase, collapsed whitespace) makes "Broken button!" and "broken
 * button !" the same report; page scoping keeps the same complaint on two
 * different pages as two rows (they may be two bugs).
 */
export function feedbackContentHash(
  suggestion: string,
  page: string | null,
  capture?: {
    intent?: "note" | "fix";
    context?: Record<string, string | number | boolean | null>;
    selectedElements?: Array<{ selector: string }>;
  },
): string {
  const normalized = `${suggestion.toLowerCase().replace(/\s+/g, " ").trim()}\n${(page ?? "").toLowerCase().trim()}`;
  // Two identical spoken comments about different controls are different notes.
  // Ignore capture time so retrying the same note still deduplicates.
  const target = capture?.context
    ? JSON.stringify([
        capture.selectedElements?.map((item) => item.selector) ?? [],
        capture.context["Screen when speaking"] ?? null,
      ])
    : "";
  const identity = `${capture?.intent === "note" ? "Review note\n" : ""}${normalized}${target ? `\n${target}` : ""}`;
  return createHash("sha256").update(identity).digest("hex");
}
