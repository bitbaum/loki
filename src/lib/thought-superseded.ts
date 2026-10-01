/**
 * The dated "this is history" notice on an essay whose architecture has since
 * been replaced.
 *
 * Essays are dated and are fine as history, but nothing used to say so: May
 * and June pieces describe the zellij worker, the standalone Brain on :3001
 * and the Neon/Vercel stack as if they were live, and the roadmap and the
 * start paths send readers to "the architecture" — where these read as
 * current. An essay opts in with one frontmatter line:
 *
 *   supersededBy: /whitepaper
 *
 * The month comes from the essay's own `publishedAt`, so the notice can never
 * claim a date the essay does not carry.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type SupersededNotice = {
  /** "June 2026" — read from publishedAt. */
  asOf: string;
  /** An internal path, e.g. "/whitepaper". */
  href: string;
};

/** "2026-06-04" → "June 2026"; anything else → null. */
export function monthOf(publishedAt: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(publishedAt.trim());
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

/**
 * The notice to show, or null when the essay is not superseded. Only internal
 * paths are accepted: the notice points at Loki's own current description,
 * never somewhere a reader cannot check against the product.
 */
export function supersededNotice(meta: {
  publishedAt: string;
  supersededBy?: string;
}): SupersededNotice | null {
  const href = meta.supersededBy?.trim();
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  const asOf = monthOf(meta.publishedAt);
  if (!asOf) return null;
  return { asOf, href };
}
