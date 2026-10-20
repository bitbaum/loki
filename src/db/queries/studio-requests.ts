import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/db";
import {
  studioRequests as requests,
  studioRequestEvents as events,
  userProjects,
  users,
  type StudioRequest,
  type WidgetToken,
} from "@/db/schema";
import type { StudioIntakeInput, StudioGuestInput, StudioStaffInput } from "@/config/studio";
import type { StudioCommissionContract } from "@/lib/studio-commission";
import { requireNotDemo } from "@/lib/demo-guard";
import { studioHash, studioKeyMatches } from "@/lib/studio/access";
import { studioView } from "@/lib/studio/projection";
import { mailStudioUpdate } from "@/lib/studio/link-mail";
import { applyBuilderSeat, seatChange, type SeatChange } from "@/lib/studio/seat";
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
/**
 * A partner a customer may be sent to: approved by the studio on their work,
 * consenting, published and available. The course pass is NOT a condition —
 * it is a credential shown beside the profile (studioPartnerDirectory).
 */
function availablePartner(row: StudioRequest | undefined): row is StudioRequest {
  return Boolean(
    row &&
    row.kind === "partner" &&
    !row.accessRevoked &&
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
  function receipt(row: StudioRequest, fresh: StudioRequest | null = null) {
    if (row.accessRevoked || row.intakeHash !== intakeHash || row.accessKeyHash !== accessKeyHash)
      throw new StudioConflict(
        "This request identifier was already used. Open your saved portal link, or start a new request.",
      );
    return { id: row.id, status: row.status, fresh };
  }
  // `fresh` is the row when this call created it, null for a replayed
  // receipt — the route announces the former and keeps it out of the response.
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
            ? "applied"
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
    return receipt(created, created);
  });
}

/**
 * The recovery door: every open request a visitor filed under this address
 * gets a fresh access key — the old link dies — and the new keys go back to
 * the route to be mailed to that same address. Hashes only are stored.
 */
export async function rotateStudioAccessByContact(userId: string, contact: string) {
  await requireNotDemo(userId, "content");
  const rows = await db
    .select({ id: requests.id, kind: requests.kind })
    .from(requests)
    .where(
      and(
        eq(requests.userId, userId),
        eq(requests.contact, contact.trim()),
        eq(requests.accessRevoked, false),
      ),
    )
    .limit(10);
  const out: { id: string; kind: "website" | "partner"; accessKey: string }[] = [];
  for (const r of rows) {
    const accessKey = `spt_${randomBytes(32).toString("base64url")}`;
    await db
      .update(requests)
      .set({ accessKeyHash: studioHash(accessKey), updatedAt: new Date() })
      .where(owned(userId, r.id));
    out.push({ id: r.id, kind: r.kind, accessKey });
  }
  return out;
}

// ── OrangeCat: an approved partner's identity ──────────────────────────────
// Applying needs no account: the private link is the key. Once approved, a
// partner may connect their OrangeCat account (the fleet's identity root), so
// a lost link is not a lost profile: signing in with OrangeCat reopens the
// application with a fresh link. Never asked for before approval.

function connectable(row: StudioRequest | undefined): row is StudioRequest {
  return Boolean(row && row.kind === "partner" && row.partnerApprovedAt && !row.accessRevoked);
}

/** The portal's own check before it hands the browser a signed connect link. */
export async function studioConnectableApplication(id: string, key: string) {
  const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  if (!accessible(row, key)) return null;
  if (!connectable(row))
    throw new StudioConflict("Connecting OrangeCat opens once the studio approves you.");
  return row;
}

/** Tie an approved application to the signed-in OrangeCat actor. Idempotent. */
export async function connectStudioOrangecat(id: string, orangecatActorId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!connectable(row))
      throw new StudioConflict("This application cannot be connected. Open it from its link.", 404);
    if (row.orangecatActorId === orangecatActorId) return row;
    if (row.orangecatActorId)
      throw new StudioConflict(
        "This application is already connected to another OrangeCat account. Sign in with that one.",
      );
    await tx
      .update(requests)
      .set({ orangecatActorId, updatedAt: new Date() })
      .where(eq(requests.id, id));
    const mutationId = randomUUID();
    await record(
      tx,
      row,
      mutationId,
      eventHash({ action: "connect_orangecat", mutationId }),
      "partner",
      "connect_orangecat",
      "Connected an OrangeCat account. Signing in with it reopens this application.",
    );
    return row;
  });
}

/** What a signed-in partner sees on Loki's /studio/partner. */
export async function studioApplicationsForActor(orangecatActorId: string) {
  const rows = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.orangecatActorId, orangecatActorId),
        eq(requests.kind, "partner"),
        eq(requests.accessRevoked, false),
      ),
    )
    .orderBy(desc(requests.updatedAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.proposedProfile?.name ?? null,
    status: studioView(row, []).status,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Reopen a connected application with a fresh private link: the old link
 * stops working, exactly as the email recovery does. Only for its own actor.
 */
export async function reopenStudioApplication(id: string, orangecatActorId: string) {
  const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  if (!row || row.accessRevoked || row.orangecatActorId !== orangecatActorId) return null;
  const accessKey = `spt_${randomBytes(32).toString("base64url")}`;
  await db
    .update(requests)
    .set({ accessKeyHash: studioHash(accessKey), updatedAt: new Date() })
    .where(eq(requests.id, id));
  return { id: row.id, accessKey };
}

export async function getStudioPortal(id: string, key: string) {
  const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  if (!accessible(row, key)) return null;
  const assignments =
    row.kind === "partner" && row.partnerApprovedAt
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
  // What happened, for the route to announce: nothing (no access), a replay
  // (announced when first applied), or the action with the row it changed.
  return db.transaction(
    async (
      tx,
    ): Promise<
      | false
      | { replay: true }
      | { replay: false; row: StudioRequest; body: string; feeFor?: StudioRequest }
    > => {
      const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
      if (!accessible(row, key)) return false;
      await requireNotDemo(row.userId, "content");
      const hash = eventHash(input);
      if (await replay(tx, row, input.mutationId, hash)) return { replay: true };
      const patch: Partial<typeof requests.$inferInsert> = { updatedAt: new Date() };
      let body = "";
      let version: number | null = null;
      let visible = true;
      let feeFor: StudioRequest | undefined;
      switch (input.action) {
        case "message":
          body = input.body;
          break;
        case "set_contact":
          patch.contact = input.contact;
          body = "Reply address added.";
          visible = false;
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
          // The course is optional and open at any stage, an approved partner
          // included: new evidence asks for a new course review and touches
          // nothing else — approval and a published profile stand.
          if (row.kind !== "partner")
            throw new StudioConflict("Course evidence belongs to a partner application.");
          validateCourseEvidence(input.assessment, contract);
          Object.assign(patch, {
            assessment: input.assessment,
            coursePassedAt: null,
            ...(row.partnerApprovedAt ? {} : { status: "course_submitted" }),
          });
          body = row.assessment
            ? "Submitted revised course evidence for review."
            : "Submitted course evidence for review.";
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
          if (row.kind !== "partner" || !row.partnerApprovedAt || !row.proposedProfile)
            throw new StudioConflict("An approved partner profile is required first.");
          patch.proposedProfile = { ...row.proposedProfile, availability: input.availability };
          body = `Availability changed to ${input.availability}.`;
          break;
        case "deliver_assignment": {
          if (row.kind !== "partner" || !row.partnerApprovedAt)
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
          // One fee per brief, stated until it is listed; after that the
          // listing on OrangeCat is the record and changes there.
          if (input.fee && assignment.feeServiceId)
            throw new StudioConflict(
              "The fee for this brief is already listed on OrangeCat; change it there.",
            );
          const nextVersion = assignment.deliveryVersion + 1;
          const delivered = {
            previewUrl: input.previewUrl,
            scope: input.scope,
            deliverySummary: input.summary,
            deliveryVersion: nextVersion,
            approvedVersion: null,
            previewAcceptedAt: null,
            status: "ready_for_review" as const,
            ...(input.fee ? { feeAmount: input.fee.amount, feeCurrency: input.fee.currency } : {}),
            updatedAt: new Date(),
          };
          await tx.update(requests).set(delivered).where(owned(row.userId, assignment.id));
          if (input.fee) feeFor = { ...assignment, ...delivered };
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
          body = input.fee
            ? `Assigned preview delivered. Fee stated: ${input.fee.amount} ${input.fee.currency}.`
            : "Assigned preview delivered.";
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
      return { replay: false, row, body, feeFor };
    },
  );
}

/** The fee's listing on OrangeCat, written once it exists there (lib/studio/fee-listing.ts). */
export async function setStudioFeeListing(
  userId: string,
  id: string,
  serviceId: string,
  url: string,
): Promise<void> {
  await db
    .update(requests)
    .set({ feeServiceId: serviceId, feeUrl: url, updatedAt: new Date() })
    .where(and(owned(userId, id), isNull(requests.feeServiceId)));
}

/**
 * OrangeCat says the fee's service was paid: the one way a brief becomes
 * paid. Idempotent on the payment (its intent id is the mutation), and a
 * brief whose fee is already paid is left alone. Returns what to tell whom.
 */
export async function markStudioFeePaid(serviceId: string, externalId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(requests)
      .where(eq(requests.feeServiceId, serviceId))
      .for("update");
    if (!row || row.feePaidAt) return null;
    const mutationId = paymentMutationId(externalId);
    const hash = eventHash({ fee_paid: externalId });
    if (await replay(tx, row, mutationId, hash)) return null;
    const [partner] = row.partnerId
      ? await tx.select().from(requests).where(eq(requests.id, row.partnerId)).limit(1)
      : [];
    const name = partner?.proposedProfile?.name ?? "the partner";
    const body = `The fee was paid to ${name} on OrangeCat.`;
    await tx
      .update(requests)
      .set({ feePaidAt: new Date(), updatedAt: new Date() })
      .where(eq(requests.id, row.id));
    await record(tx, row, mutationId, hash, "studio", "fee_paid", body);
    return { row, partner: partner ?? null, body };
  });
}

/** A payment intent id as the UUID the events table keys replays on. */
function paymentMutationId(externalId: string): string {
  const hex = createHash("sha256").update(`oc-fee-paid:${externalId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
    partnerName: row.kind === "partner" ? (row.proposedProfile?.name ?? null) : null,
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
    builderUserId: row.builderUserId,
    preferredPartnerId: row.preferredPartnerId,
    revoked: row.accessRevoked,
  };
}
export type StudioReviewView = NonNullable<Awaited<ReturnType<typeof getStudioReview>>>;

export async function mutateStudioReview(userId: string, id: string, input: StudioStaffInput) {
  await requireNotDemo(userId, "content");
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(requests).where(owned(userId, id)).for("update");
    if (!row) return null;
    const hash = eventHash(input);
    if (await replay(tx, row, input.mutationId, hash)) return { tell: null };
    const patch: Partial<typeof requests.$inferInsert> = { updatedAt: new Date() };
    let body = "";
    let version: number | null = null;
    let visible = true;
    let seat: SeatChange | null = null;
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
        seat = seatChange(row, { projectId: input.projectId, builderUserId: row.builderUserId });
        body = row.builderUserId
          ? "Linked an internal project; the assigned partner holds a seat on it."
          : "Linked an internal project without granting project access.";
        visible = false;
        break;
      }
      case "review_course":
        // Reviewed against the course version the evidence was submitted for
        // (checked at submission), not a live fetch of today's course: a
        // course update or a slow studio site used to block every review.
        if (row.kind !== "partner" || !row.assessment)
          throw new StudioConflict("There is no course evidence to review yet.");
        Object.assign(patch, {
          coursePassedAt: input.passed ? new Date() : null,
          // An approved partner stays approved whatever the course result.
          ...(row.partnerApprovedAt
            ? {}
            : { status: input.passed ? "course_passed" : "needs_information" }),
        });
        body = input.body;
        break;
      case "approve_partner":
        // Approval is a person's decision on the applicant's work — what they
        // wrote, the links they gave, and course evidence if they chose to
        // take it. The course is never a precondition.
        if (row.kind !== "partner" || row.accessRevoked)
          throw new StudioConflict("Only an open partner application can be approved.");
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
            "Approval, publication consent and an available profile are required.",
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
        // The partner's Loki account, when they have signed in with the
        // OrangeCat identity they connected: the holder of the seat on the
        // linked project, building in their own tenant on their own engine.
        const [builder] = partner.orangecatActorId
          ? await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.orangecatActorId, partner.orangecatActorId))
              .limit(1)
          : [];
        patch.builderUserId = builder?.id ?? null;
        seat = seatChange(row, { projectId: row.projectId, builderUserId: builder?.id ?? null });
        body = `Assigned to ${partner.proposedProfile!.name}. Scope and timing are agreed directly with the independent partner; a fee they state with a delivery is paid to them on OrangeCat.`;
        break;
      }
      case "revoke_access":
        patch.accessRevoked = true;
        seat = seatChange(row, { projectId: null, builderUserId: null });
        body = "Guest access revoked.";
        visible = false;
        break;
    }
    await tx.update(requests).set(patch).where(owned(userId, id));
    await record(tx, row, input.mutationId, hash, "studio", input.action, body, version, visible);
    // What the visitor can see is what they are told about (a replayed
    // mutation tells nobody twice).
    return { tell: visible ? { to: row.contact, kind: row.kind, note: body } : null, seat };
  });
  if (!saved) return false;
  if (saved.seat) await applyBuilderSeat(saved.seat);
  if (saved.tell) mailStudioUpdate(saved.tell);
  return true;
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
        isNotNull(requests.partnerApprovedAt),
        isNotNull(requests.profileConsentAt),
        isNotNull(requests.profilePublishedAt),
      ),
    )
    .orderBy(desc(requests.updatedAt));
  return rows.filter(availablePartner).map((row) => ({
    id: row.id,
    ...row.proposedProfile!,
    // The course credential, when earned: shown beside the profile, never
    // required to be on it.
    coursePassed: Boolean(row.coursePassedAt),
  }));
}
