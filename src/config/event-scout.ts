/**
 * What the event scout goes looking for, and where it will and won't go.
 *
 * Config rather than code because this is a statement of the operator's taste,
 * and taste changes. Editing a query here should never mean touching the
 * pipeline that runs it (lib/events/scout.ts).
 *
 * Chosen 2026-09-17 from the operator's own answers: all four purposes
 * (collaborators, clients/pilots, visibility, learning), Zurich and Switzerland
 * only — no online, no Europe — and five kinds of gathering, of which the fifth
 * was added by hand and matters: PARTIES AND FESTIVALS. Culture is not a
 * rounding error on a work calendar; that calendar already had Autechre at Rote
 * Fabrik in it. A scout that only ever proposed conferences would be quietly
 * refusing to know the person it works for.
 */

/** One thing to search for, and why it earns a place in a capped digest. */
export type ScoutTopic = {
  /** Stable id — also the dedupe/learning key, so never reuse one for a new meaning. */
  key: string;
  /** Sent to the search chain verbatim. */
  query: string;
  /** Written onto the event row; groups the digest and explains the pick. */
  category: string;
  /** One line the digest can show: why THIS is worth the operator's evening. */
  rationale: string;
};

export const SCOUT_TOPICS: readonly ScoutTopic[] = [
  {
    key: "meetup-ai",
    query: "AI machine learning meetup Zürich upcoming events",
    category: "meetup",
    rationale: "small rooms, same faces — where collaborators actually come from",
  },
  {
    key: "meetup-dev",
    query: "software developer meetup Zürich Rust TypeScript Python upcoming",
    category: "meetup",
    rationale: "builders in the room, not an audience",
  },
  {
    key: "hackathon",
    query: "Hackathon Zürich Schweiz upcoming apply",
    category: "hackathon",
    rationale: "you meet people by building next to them",
  },
  {
    key: "conference-cfp",
    query: "call for speakers conference Switzerland tech submit talk deadline",
    category: "cfp",
    rationale: "a talk is distribution — the thing 32 repos and 2 stars are short of",
  },
  {
    key: "civic",
    query: "civic tech open data public sector event Zürich Schweiz",
    category: "civic",
    rationale: "the rooms where SBB/AOZ-shaped work gets commissioned",
  },
  {
    key: "sustainability",
    query: "Reparatur Kreislaufwirtschaft circular economy event Zürich",
    category: "civic",
    rationale: "the world Reparaturbonus and RevampIT already live in",
  },
  {
    key: "culture",
    query: "Rote Fabrik Zentralwäscherei Zürich concerts festival programme",
    category: "culture",
    rationale: "the reason to live here, not only to work here",
  },
  {
    key: "festival",
    query: "Festival Zürich Schweiz electronic music art upcoming",
    category: "culture",
    rationale: "worth planning around rather than missing by a week",
  },
] as const;

/**
 * How many suggestions may reach the operator in one digest.
 *
 * Six. The cap is the product, not a safety valve: with every purpose selected
 * the ranking cannot lean on exclusion, so this is what stops a curated handful
 * from becoming a feed. Better to miss a good event than to send the message
 * that teaches him to swipe past the next one.
 */
export const SCOUT_MAX_SUGGESTIONS = 6;

/**
 * How far ahead to look.
 *
 * Three weeks: far enough that a Saturday festival can still be planned around,
 * near enough that the date in a search snippet is worth believing. Beyond
 * that, listings go stale and "upcoming" starts meaning last year — the exact
 * failure that made a 2025 meetup the top hit while building this.
 */
export const SCOUT_HORIZON_DAYS = 21;

/** Per-topic result ceiling before extraction — keeps one batched model call small. */
export const SCOUT_RESULTS_PER_TOPIC = 6;
