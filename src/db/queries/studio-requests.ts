import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  studioRequests as requests,
  studioRequestEvents as events,
  userProjects,
  type StudioRequest,
  type WidgetToken,
} from "@/db/schema";
import type { StudioIntakeInput, StudioGuestInput, StudioStaffInput } from "@/config/studio";
import type { StudioCommissionContract } from "@/lib/studio-commission";
import { requireNotDemo } from "@/lib/demo-guard";
import { studioHash, studioKeyMatches } from "@/lib/studio/access";
import { studioView } from "@/lib/studio/projection";
import {
  StudioConflict,
  validateCourseEvidence,
  requireCurrentPreview,
  requireDeliveryVersion,
} from "@/lib/studio/policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const owned = (userId: string, id: string) => and(eq(requests.userId, userId), eq(requests.id, id));
const eventHash = (input: unknown) => studioHash(JSON.stringify(input));
function accessible(row: StudioRequest | undefined, key: string): row is StudioRequest {
  return Boolean(row && !row.accessRevoked && studioKeyMatches(key, row.accessKeyHash));
}
function availablePartner(row: StudioRequest | undefined): row is StudioRequest {
  return Boolean(
    row &&
    row.kind === "partner" &&
    !row.accessRevoked &&
    row.coursePassedAt &&
    row.partnerApprovedAt &&
    row.proposedProfile &&
    row.profileConsentAt &&
    row.profilePublishedAt &&
    row.proposedProfile.availability !== "unavailable",
  );
}
async function history(tx: Tx | typeof db, userId: string, requestId: string) {
  return tx
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.requestId, requestId)))
    .orderBy(asc(events.createdAt), asc(events.id));
}
async function replay(tx: Tx, row: StudioRequest, mutationId: string, hash: string) {
  const [event] = await tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, row.userId),
        eq(events.requestId, row.id),
        eq(events.mutationId, mutationId),
      ),
    )
    .limit(1);
  if (!event) return false;
  if (event.mutationHash !== hash)
    throw new StudioConflict("That retry belongs to a different action. Reload before continuing.");
  return true;
}
async function record(
  tx: Tx,
  row: StudioRequest,
  mutationId: string,
  hash: string,
  actor: "customer" | "partner" | "studio",
  kind: string,
  body: string,
  version: number | null = null,
  visible = true,
) {
  await tx.insert(events).values({
    userId: row.userId,
    requestId: row.id,
    mutationId,
    mutationHash: hash,
    actor,
    kind,
    body,
    deliveryVersion: version,
    visible,
  });
}

export async function createStudioRequest(
  token: WidgetToken,
  contract: StudioCommissionContract,
  input: StudioIntakeInput,
) {
  await requireNotDemo(token.userId, "content");
  const requestKeyHash = studioHash(input.requestId);
  const accessKeyHash = studioHash(input.accessKey);
  const { accessKey: _key, company: _company, ...brief } = input;
  const intakeHash = eventHash(brief);
  function receipt(row: StudioRequest) {
    if (row.accessRevoked || row.intakeHash !== intakeHash || row.accessKeyHash !== accessKeyHash)
      throw new StudioConflict(
        "This request identifier was already used. Open your saved portal link, or start a new request.",
      );
    return { id: row.id, status: row.status };
  }
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(requests)
      .where(and(eq(requests.userId, token.userId), eq(requests.requestKeyHash, requestKeyHash)))
      .limit(1);
    if (previous) return receipt(previous);
    if (
      input.kind === "website" &&
      input.target === "studio" &&
      input.offerId !== contract.offer.id
    )
      throw new StudioConflict(
        "The published offer changed. Reload to review its terms; your brief is saved.",
      );
    if (input.kind === "partner" && !contract.course)
      throw new StudioConflict(
        "The course is unavailable. Your application is saved in this browser; try again later.",
        503,
      );
    if (input.kind === "website" && input.preferredPartnerId) {
      if (input.target !== "partner")
        throw new StudioConflict("Choose the partner route to request this partner.", 400);
      const [partner] = await tx
        .select()
        .from(requests)
        .where(owned(token.userId, input.preferredPartnerId))
        .limit(1);
      if (!availablePartner(partner))
        throw new StudioConflict(
          "This partner is not currently available. Choose another partner or submit without a preference.",
        );
    }
    const [created] = await tx
      .insert(requests)
      .values({
        userId: token.userId,
        studioProjectId: token.projectId,
        tokenId: token.id,
        requestKeyHash,
        accessKeyHash,
        intakeHash,
        kind: input.kind,
        target: input.kind === "partner" ? "application" : input.target,
        website: input.website,
        changes: input.changes,
        contact: input.contact || null,
        status:
          input.kind === "partner"
            ? "course_in_progress"
            : input.target === "studio" && contract.availability.state === "closed"
              ? "waitlisted"
              : "review",
        preferredPartnerId: input.kind === "website" ? input.preferredPartnerId : undefined,
        offerSnapshot:
          input.kind === "website" && input.target === "studio" ? contract.offer : null,
      })
      .onConflictDoNothing({ target: [requests.userId, requests.requestKeyHash] })
      .returning();
    if (!created) {
      const [raced] = await tx
        .select()
        .from(requests)
        .where(and(eq(requests.userId, token.userId), eq(requests.requestKeyHash, requestKeyHash)))
        .limit(1);
      if (!raced) throw new StudioConflict("The request could not be saved. Retry the same brief.");
      return receipt(raced);
    }
    await record(
      tx,
      created,
      input.requestId,
      intakeHash,
      input.kind === "partner" ? "partner" : "customer",
      "received",
      input.kind === "partner"
        ? "Application saved. Submit the pilot course evidence for studio review."
        : "Brief saved. Sending this request does not book work or approve a price.",
    );
    return receipt(created);
  });
}

export async function getStudioPortal(id: string, key: string) {
  const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  if (!accessible(row, key)) return null;
  const assignments =
    row.kind === "partner" && row.coursePassedAt && row.partnerApprovedAt
      ? await db
          .select()
          .from(requests)
          .where(
            and(
              eq(requests.userId, row.userId),
              eq(requests.partnerId, row.id),
              eq(requests.accessRevoked, false),
            ),
          )
          .orderBy(desc(requests.updatedAt))
      : [];
  return {
    request: studioView(row, await history(db, row.userId, row.id)),
    assignments: await Promise.all(
      assignments.map(async (r) => studioView(r, await history(db, r.userId, r.id))),
    ),
  };
}

export async function mutateStudioPortal(
  id: string,
  key: string,
  input: StudioGuestInput,
  contract: StudioCommissionContract | null = null,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!accessible(row, key)) return false;
    await requireNotDemo(row.userId, "content");
    const hash = eventHash(input);
    if (await replay(tx, row, input.mutationId, hash)) return true;
    const patch: Partial<typeof requests.$inferInsert> = { updatedAt: new Date() };
    let body = "";
    let version: number | null = null;
    let visible = true;
    switch (input.action) {
      case "message":
        body = input.body;
        break;
      case "accept_preview":
        requireCurrentPreview(row, input.version);
        Object.assign(patch, {
          approvedVersion: input.version,
          previewAcceptedAt: new Date(),
          status: "accepted",
        });
        body =
          "Accepted this preview and its stated scope. Production publication is agreed separately.";
        version = input.version;
        break;
      case "request_changes":
        requireCurrentPreview(row, input.version);
        Object.assign(patch, {
          approvedVersion: null,
          previewAcceptedAt: null,
          status: "changes_requested",
        });
        body = input.body;
        version = input.version;
        break;
      case "submit_assessment":
        if (row.kind !== "partner" || row.partnerApprovedAt)
          throw new StudioConflict(
            "Course evidence can be submitted from an unapproved partner application.",
          );
        validateCourseEvidence(input.assessment, contract);
        Object.assign(patch, {
          assessment: input.assessment,
          coursePassedAt: null,
          partnerApprovedAt: null,
          profilePublishedAt: null,
          status: "course_submitted",
        });
        body = "Submitted revised capstone evidence for review.";
        break;
      case "propose_profile":
        if (row.kind !== "partner")
          throw new StudioConflict("Only partner applications have a public profile.");
        Object.assign(patch, {
          proposedProfile: input.profile,
          profileConsentAt: new Date(),
          profilePublishedAt: null,
        });
        body =
          "Proposed a public profile with consent to publication. Studio review is still required.";
        break;
      case "set_availability":
        if (
          row.kind !== "partner" ||
          !row.partnerApprovedAt ||
          !row.coursePassedAt ||
          !row.proposedProfile
        )
          throw new StudioConflict("An approved partner profile is required first.");
        patch.proposedProfile = { ...row.proposedProfile, availability: input.availability };
        body = `Availability changed to ${input.availability}.`;
        break;
      case "deliver_assignment": {
        if (row.kind !== "partner" || !row.partnerApprovedAt || !row.coursePassedAt)
          throw new StudioConflict("Only an approved partner may deliver assigned work.");
        const [assignment] = await tx
          .select()
          .from(requests)
          .where(
            and(
              owned(row.userId, input.requestId),
              eq(requests.partnerId, row.id),
              eq(requests.accessRevoked, false),
            ),
          )
          .for("update");
        if (!assignment || assignment.kind !== "website" || assignment.status === "closed")
          throw new StudioConflict("This brief is not assigned to you or is closed.", 404);
        requireDeliveryVersion(assignment.deliveryVersion, input.expectedVersion);
        const nextVersion = assignment.deliveryVersion + 1;
        await tx
          .update(requests)
          .set({
            previewUrl: input.previewUrl,
            scope: input.scope,
            deliverySummary: input.summary,
            deliveryVersion: nextVersion,
            approvedVersion: null,
            previewAcceptedAt: null,
            status: "ready_for_review",
            updatedAt: new Date(),
          })
          .where(owned(row.userId, assignment.id));
        await record(
          tx,
          assignment,
          input.mutationId,
          hash,
          "partner",
          "publish_preview",
          input.summary,
          nextVersion,
        );
        body = "Assigned preview delivered.";
        visible = false;
        break;
      }
    }
    await tx.update(requests).set(patch).where(owned(row.userId, row.id));
    await record(
      tx,
      row,
      input.mutationId,
      hash,
      row.kind === "partner" ? "partner" : "customer",
      input.action,
      body,
      version,
      visible,
    );
    return true;
  });
}

export async function listStudioRequests(userId: string) {
  const rows = await db
    .select()
    .from(requests)
    .where(eq(requests.userId, userId))
    .orderBy(desc(requests.updatedAt))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    target: row.target,
    website: row.website,
    changes: row.changes,
    status: row.status,
    revoked: row.accessRevoked,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
export async function getStudioReview(userId: string, id: string) {
  const [row] = await db.select().from(requests).where(owned(userId, id)).limit(1);
  if (!row) return null;
  return {
    ...studioView(row, await history(db, userId, id)),
    contact: row.contact,
    projectId: row.projectId,
    partnerId: row.partnerId,
    preferredPartnerId: row.preferredPartnerId,
    revoked: row.accessRevoked,
  };
}
export type StudioReviewView = NonNullable<Awaited<ReturnType<typeof getStudioReview>>>;

export async function mutateStudioReview(
  userId: string,
  id: string,
  input: StudioStaffInput,
  contract: StudioCommissionContract | null = null,
) {
  await requireNotDemo(userId, "content");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(requests).where(owned(userId, id)).for("update");
    if (!row) return false;
    const hash = eventHash(input);
    if (await replay(tx, row, input.mutationId, hash)) return true;
    const patch: Partial<typeof requests.$inferInsert> = { updatedAt: new Date() };
    let body = "";
    let version: number | null = null;
    let visible = true;
    switch (input.action) {
      case "message":
        body = input.body;
        break;
      case "set_status":
        if (row.kind === "partner" && row.partnerApprovedAt)
          throw new StudioConflict(
            "Use the partner decision to withdraw approval or keep this application approved.",
          );
        if (row.kind === "partner" && input.status === "in_progress")
          throw new StudioConflict("Use course review and partner approval for this application.");
        patch.status = input.status;
        body = input.body;
        break;
      case "publish_preview":
        if (row.kind !== "website" || row.accessRevoked || row.status === "closed")
          throw new StudioConflict("An open website brief is required.");
        requireDeliveryVersion(row.deliveryVersion, input.expectedVersion);
        version = row.deliveryVersion + 1;
        Object.assign(patch, {
          deliveryVersion: version,
          previewUrl: input.previewUrl,
          scope: input.scope,
          deliverySummary: input.summary,
          approvedVersion: null,
          previewAcceptedAt: null,
          status: "ready_for_review",
        });
        body = input.summary;
        break;
      case "link_project": {
        const [project] = await tx
          .select({ id: userProjects.id })
          .from(userProjects)
          .where(
            and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, input.projectId)),
          )
          .limit(1);
        if (!project)
          throw new StudioConflict("Select a project owned by this studio account.", 404);
        patch.projectId = input.projectId;
        body = "Linked an internal project without granting project access.";
        visible = false;
        break;
      }
      case "review_course":
        if (row.kind !== "partner" || row.partnerApprovedAt)
          throw new StudioConflict("Use an unapproved partner application for course review.");
        validateCourseEvidence(row.assessment, contract);
        Object.assign(patch, {
          coursePassedAt: input.passed ? new Date() : null,
          status: input.passed ? "course_passed" : "needs_information",
        });
        body = input.body;
        break;
      case "approve_partner":
        if (row.kind !== "partner" || !row.coursePassedAt || row.accessRevoked)
          throw new StudioConflict("Pass the course review before approving the application.");
        validateCourseEvidence(row.assessment, contract);
        Object.assign(patch, { partnerApprovedAt: new Date(), status: "approved" });
        body = input.body;
        break;
      case "decline_partner":
        if (row.kind !== "partner") throw new StudioConflict("This is not a partner application.");
        Object.assign(patch, {
          partnerApprovedAt: null,
          profilePublishedAt: null,
          status: "declined",
        });
        body = input.body;
        break;
      case "publish_profile":
        if (!availablePartner({ ...row, profilePublishedAt: new Date() }))
          throw new StudioConflict(
            "Approval, course pass, publication consent and an available profile are required.",
          );
        patch.profilePublishedAt = new Date();
        body = "Approved profile published in the partner directory.";
        break;
      case "assign_partner": {
        if (
          row.kind !== "website" ||
          row.target !== "partner" ||
          row.accessRevoked ||
          row.status === "closed"
        )
          throw new StudioConflict("The customer must choose the partner route before assignment.");
        const [partner] = await tx
          .select()
          .from(requests)
          .where(owned(userId, input.partnerId))
          .limit(1);
        if (!availablePartner(partner))
          throw new StudioConflict(
            "Select an approved, published partner with current availability.",
          );
        patch.partnerId = partner.id;
        body = `Assigned to ${partner.proposedProfile!.name}. Scope, timing and payment are agreed directly with the independent partner.`;
        break;
      }
      case "revoke_access":
        patch.accessRevoked = true;
        body = "Guest access revoked.";
        visible = false;
        break;
    }
    await tx.update(requests).set(patch).where(owned(userId, id));
    await record(tx, row, input.mutationId, hash, "studio", input.action, body, version, visible);
    return true;
  });
}

export async function studioPartnerDirectory(userId: string) {
  const rows = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.userId, userId),
        eq(requests.kind, "partner"),
        eq(requests.accessRevoked, false),
        isNotNull(requests.coursePassedAt),
        isNotNull(requests.partnerApprovedAt),
        isNotNull(requests.profileConsentAt),
        isNotNull(requests.profilePublishedAt),
      ),
    )
    .orderBy(desc(requests.updatedAt));
  return rows.filter(availablePartner).map((row) => ({ id: row.id, ...row.proposedProfile! }));
}
