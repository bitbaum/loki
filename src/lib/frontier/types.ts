// Shared types for the daily frontier digest — the latest AI / robotics /
// frontier-tech developments, distilled for the public site AND (next
// increment) the fleet's own self-improvement briefing.
//
// SSOT for the item shape stored in the frontier_digests.items JSONB column.
// The DB schema imports FrontierItem so the column type and the app type can
// never drift.

/** Coarse content bucket, set deterministically by the source (never the LLM,
 *  so it can't be hallucinated). Rendered as a chip on the public digest. */
export type FrontierCategory = "research" | "robotics" | "ml" | "community";

/** One curated item in a published digest. title/url/source/category always
 *  come from the real fetched feed; only `summary` is LLM-authored. */
export type FrontierItem = {
  title: string;
  url: string;
  source: string;
  category: FrontierCategory;
  /** One-sentence "why it matters", written by the ranking model. */
  summary: string;
};
