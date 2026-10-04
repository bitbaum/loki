/**
 * The short form of a feedback note that strangers read on the public homepage.
 *
 * A note is written for the agent that will fix it, so it often carries the
 * measurements that made it fixable: "On mobile (320px wide), the feedback
 * widget's floating action button (fixed, 48x48px, z-index 2147483000) …".
 * Sliced at 140 characters, that is what the homepage's "Notes in, fixes out"
 * card showed visitors on 2026-10-04, ending mid-word in "permanently o…".
 *
 * So: drop the bracketed asides, keep the first sentence when it is short
 * enough to stand alone, and otherwise end on a word, not inside one.
 */
export function publicFeedbackExcerpt(text: string, max = 140): string {
  const plain = text
    .replace(/\s*\([^()]*\)/g, "")
    .replace(/\s*\[[^[\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  const firstSentence = plain.match(/^.+?[.!?](?=\s|$)/)?.[0];
  if (firstSentence && firstSentence.length <= max) return firstSentence;
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${head.replace(/[\s,;:—-]+$/, "")}…`;
}
