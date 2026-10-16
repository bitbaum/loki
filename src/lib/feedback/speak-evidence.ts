/**
 * Live-check evidence is read by the owner on a card as Loki talking. Pure
 * (no model, no database) because the feedback inbox, a client component,
 * renders it — keep it free of server imports.
 */

/** Machine phrasing a model still slips in, turned into how a person says it. */
export function speakEvidence(evidence: string | null | undefined): string | null {
  if (!evidence) return null;
  const spoken = evidence
    .replace(
      /\b(the )?(provided|given|supplied) (live )?(page )?(text|content|excerpt)\b/gi,
      "the page",
    )
    .replace(/\bthe (live )?page text\b/gi, "the page")
    .replace(/\b(the )?(provided|given|supplied) (picture|image|screenshot)\b/gi, "the screen")
    .replace(/\bthe page (does not|doesn't) contain\b/gi, "I could not find, on the page,")
    .replace(/^the page/, "The page")
    .trim();
  return spoken || null;
}
