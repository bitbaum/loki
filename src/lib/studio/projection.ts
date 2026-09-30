import { STUDIO_STATUS } from "@/config/studio";
import type { StudioRequest, StudioRequestEvent } from "@/db/schema/studio-requests";
/** Explicit allowlist. Nothing from the project, owner or credential record leaks through a spread. */
export function studioView(row: StudioRequest, events: StudioRequestEvent[]) {
  const status = STUDIO_STATUS[row.status];
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    website: row.website,
    changes: row.changes,
    offer: row.offerSnapshot,
    status: { id: row.status, title: status[0], next: status[1] },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    delivery: row.previewUrl
      ? {
          version: row.deliveryVersion,
          url: row.previewUrl,
          scope: row.scope,
          summary: row.deliverySummary,
          accepted: row.approvedVersion === row.deliveryVersion,
        }
      : null,
    partner:
      row.kind === "partner"
        ? {
            assessment: row.assessment,
            coursePassed: Boolean(row.coursePassedAt),
            approved: Boolean(row.partnerApprovedAt),
            profile: row.proposedProfile,
            profilePublished: Boolean(row.profilePublishedAt),
          }
        : null,
    history: events
      .filter((e) => e.visible)
      .map((e) => ({
        id: e.id,
        actor: e.actor,
        kind: e.kind,
        body: e.body,
        version: e.deliveryVersion,
        at: e.createdAt.toISOString(),
      })),
  };
}
export type StudioView = ReturnType<typeof studioView>;
