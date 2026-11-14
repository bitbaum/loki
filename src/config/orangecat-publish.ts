/**
 * Promote policy — which Loki moments reach OrangeCat's publish bus.
 *
 * OrangeCat's `timeline_events` is a curated PUBLIC projection, not a mirror of
 * Loki's private event spine. This config is the single place that decides
 * what is publish-worthy and how it maps onto OrangeCat's allowed event types
 * (a fixed subset enforced by OC's inbound contract — see the OC repo,
 * src/config/external-publish.ts). Never publish from a call site directly;
 * route through src/lib/integrations/orangecat-publish.ts, which consults this.
 *
 * DECISION, 2026-11-14: a build log is not a post. OrangeCat's timeline is its
 * community feed, read by people deciding whether anyone lives there, and for
 * months what they met was this product's working notes: "orangecat: e2e ok —
 * no changes", lists of pull request numbers, commit hashes (78 of 80 posts on
 * the public feed, 2026-11-13). Those are true and they are for the operator;
 * they stay in Loki, where the project's own page, its dev log and Control
 * already show them. OrangeCat now hides them from its community page, but the
 * right fix is not to send them.
 *
 * So the rule is: a moment reaches OrangeCat only if a person who has never
 * seen the repository would want to read it. Today exactly one does, the
 * project going public. Closed runs and dev-log entries are written by agents
 * for the next agent and are off. A release written for people (the
 * repository's CHANGELOG.md, which the fleet map already reads) is the
 * candidate for the next moment; it is added here as its own entry when it is
 * built, not by switching these two back on.
 */

import { APP_URL } from "./brand";

/** OC-side event types the bus accepts (ceiling defined on the OC side). */
export type OrangeCatPublishEventType =
  | "project_updated"
  | "project_milestone"
  | "project_completed"
  | "project_goal_reached"
  | "project_published";

/** Loki moments that MAY be promoted, and how they map onto OC's taxonomy. */
export const PROMOTE_POLICY = {
  /** A dev-log entry was appended (agent or human changelog note). */
  devlog_entry: { enabled: false, eventType: "project_updated" as OrangeCatPublishEventType },
  /** The project was first published to OrangeCat. */
  project_published: { enabled: true, eventType: "project_published" as OrangeCatPublishEventType },
  /** An orchestration run closed successfully. Off: see the decision above. */
  run_closed: { enabled: false, eventType: "project_updated" as OrangeCatPublishEventType },
} as const satisfies Record<string, { enabled: boolean; eventType: OrangeCatPublishEventType }>;

/** Whether a moment is sent at all. Callers that build a queue of moments ask
 *  this first, so a switched-off moment costs no request and no place in line. */
export function isPromoted(moment: keyof typeof PROMOTE_POLICY): boolean {
  return PROMOTE_POLICY[moment].enabled;
}

export type PromotableMoment = keyof typeof PROMOTE_POLICY;

/** Public Loki URL used for deep-links back from the OrangeCat wall. */
export const LOKI_PUBLIC_ORIGIN = APP_URL;
