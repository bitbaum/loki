import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { COMMISSION } from "../../src/config/commission";
import { StudioContract } from "../../src/lib/studio-commission";
import { StudioIntake, StudioGuestAction, StudioStaffAction } from "../../src/config/studio";

/** Runs against the migrated CI/scratch database, creates only UUID-scoped test
 * tenants, and removes their records in finally. No live customer identifiers. */
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must be a migrated scratch/CI database");
  const { db } = await import("../../src/db");
  const { users, entities, userProjects, widgetTokens, studioRequests, studioRequestEvents } =
    await import("../../src/db/schema");
  const {
    createStudioRequest,
    getStudioPortal,
    mutateStudioPortal,
    getStudioReview,
    mutateStudioReview,
    studioPartnerDirectory,
  } = await import("../../src/db/queries/studio-requests");
  const owners = [randomUUID(), randomUUID()];
  const key = () => `spt_${randomBytes(32).toString("base64url")}`;
  const contract = StudioContract.parse({
    version: 1,
    origin: COMMISSION.studioOrigin,
    availability: { state: "closed", line: "Test capacity is closed" },
    offer: {
      id: "rescue",
      name: "Rescue",
      price: "CHF 6,500",
      shape: "Two weeks",
      what: "Assessment scope",
    },
    feedbackToken: "fcw_test",
    course: {
      version: "pilot-v1",
      title: "Pilot",
      pilot: true,
      modules: [{ id: "problem-constraints", title: "Problem" }],
    },
  });
  try {
    await db.insert(users).values(owners.map((id) => ({ id, name: "Studio portal test" })));
    const projects = await db
      .insert(entities)
      .values(
        owners.map((userId) => ({ userId, name: "studio-portal-test", type: "project" as const })),
      )
      .returning();
    for (const project of projects)
      await db.insert(userProjects).values({
        userId: project.userId,
        name: "studio-portal-test",
        entityProjectId: project.id,
      });
    const tokens = await db
      .insert(widgetTokens)
      .values(
        projects.map((p) => ({
          projectId: p.id,
          userId: p.userId,
          token: `fcw_${randomBytes(16).toString("hex")}`,
          origins: [COMMISSION.studioOrigin],
        })),
      )
      .returning();
    const token = tokens.find((t) => t.userId === owners[0])!;
    const ownedProject = projects.find((p) => p.userId === owners[0])!;
    const foreignProject = projects.find((p) => p.userId === owners[1])!;
    const access = key();
    const input = StudioIntake.parse({
      kind: "website",
      target: "studio",
      website: "bitbaum.orangecat.ch",
      changes: "A test request for a mobile booking flow",
      requestId: randomUUID(),
      accessKey: access,
      offerId: "rescue",
    });
    const [receipt, retry] = await Promise.all([
      createStudioRequest(token, contract, input),
      createStudioRequest(token, contract, input),
    ]);
    assert.equal(receipt.id, retry.id);
    assert.equal(receipt.status, "waitlisted");
    const initialEvents = await db
      .select()
      .from(studioRequestEvents)
      .where(eq(studioRequestEvents.requestId, receipt.id));
    assert.equal(initialEvents.length, 1);
    assert.equal(await getStudioPortal(receipt.id, key()), null);
    assert.equal(await getStudioReview(owners[1], receipt.id), null);
    const guest = (id: string, access: string, action: Record<string, unknown>) =>
      mutateStudioPortal(
        id,
        access,
        StudioGuestAction.parse({ mutationId: randomUUID(), ...action }),
        contract,
      );
    const staff = (id: string, action: Record<string, unknown>, userId = owners[0]) =>
      mutateStudioReview(
        userId,
        id,
        StudioStaffAction.parse({ mutationId: randomUUID(), ...action }),
        contract,
      );
    assert.equal(
      await staff(receipt.id, { action: "message", body: "Cannot cross tenants" }, owners[1]),
      false,
    );
    await assert.rejects(
      staff(receipt.id, { action: "link_project", projectId: foreignProject.id }),
    );
    await staff(receipt.id, { action: "link_project", projectId: ownedProject.id });
    const privateView = JSON.stringify(await getStudioPortal(receipt.id, access));
    for (const sensitive of [owners[0], token.token, token.id, ownedProject.id, access])
      assert.equal(privateView.includes(sensitive), false);
    await staff(receipt.id, {
      action: "publish_preview",
      expectedVersion: 0,
      previewUrl: "https://bitbaum.orangecat.ch",
      scope: "Test booking flow on mobile",
      summary: "The journey and its error recovery were checked.",
    });
    await assert.rejects(guest(receipt.id, access, { action: "accept_preview", version: 0 }));
    const acceptance = StudioGuestAction.parse({
      mutationId: randomUUID(),
      action: "accept_preview",
      version: 1,
    });
    await mutateStudioPortal(receipt.id, access, acceptance);
    await mutateStudioPortal(receipt.id, access, acceptance);
    assert.equal((await getStudioPortal(receipt.id, access))!.request.delivery!.accepted, true);
    await assert.rejects(
      mutateStudioPortal(
        receipt.id,
        access,
        StudioGuestAction.parse({
          mutationId: acceptance.mutationId,
          action: "message",
          body: "Different action with reused id",
        }),
      ),
    );
    await staff(receipt.id, {
      action: "publish_preview",
      expectedVersion: 1,
      previewUrl: "https://bitbaum.orangecat.ch/revision",
      scope: "Revised booking scope on mobile",
      summary: "A second revision with new verification evidence.",
    });
    await assert.rejects(guest(receipt.id, access, { action: "accept_preview", version: 1 }));
    await mutateStudioPortal(receipt.id, access, acceptance); // replay is acknowledged but never accepts v2
    assert.equal((await getStudioPortal(receipt.id, access))!.request.delivery!.accepted, false);
    assert.equal((await getStudioPortal(receipt.id, access))!.request.delivery!.version, 2);
    const partnerKey = key();
    const application = await createStudioRequest(
      token,
      contract,
      StudioIntake.parse({
        kind: "partner",
        requestId: randomUUID(),
        accessKey: partnerKey,
        changes: "A builder applying with a transferable practical capstone",
      }),
    );
    await assert.rejects(
      staff(application.id, {
        action: "approve_partner",
        body: "Cannot approve before course pass",
      }),
    );
    const assessment = {
      version: "pilot-v1",
      answers: {
        "problem-constraints":
          "The concrete user journey and testable constraints are recorded here.",
      },
      projectUrl: "https://bitbaum.orangecat.ch",
      sourceUrl: "https://github.com/bitbaum/bitbaum",
    };
    await guest(application.id, partnerKey, { action: "submit_assessment", assessment });
    await staff(application.id, {
      action: "review_course",
      passed: true,
      body: "The evidence meets all dimensions in the pilot rubric.",
    });
    assert.equal(
      (await getStudioPortal(application.id, partnerKey))!.request.partner!.approved,
      false,
    );
    const profile = {
      name: "Test partner",
      headline: "Test evidence only",
      url: "https://github.com/bitbaum",
      rate: "Direct quote",
      availability: "available",
    };
    await guest(application.id, partnerKey, { action: "propose_profile", profile, consent: true });
    await assert.rejects(staff(application.id, { action: "publish_profile" }));
    await staff(application.id, {
      action: "approve_partner",
      body: "Studio review approved this test partner after the course pass.",
    });
    await assert.rejects(
      staff(application.id, {
        action: "set_status",
        status: "closed",
        body: "Generic closure must not bypass the explicit partner decision.",
      }),
    );
    assert.equal((await studioPartnerDirectory(owners[0])).length, 0);
    await staff(application.id, { action: "publish_profile" });
    assert.equal((await studioPartnerDirectory(owners[0])).length, 1);
    assert.equal((await studioPartnerDirectory(owners[1])).length, 0);
    await guest(application.id, partnerKey, {
      action: "set_availability",
      availability: "unavailable",
    });
    assert.equal((await studioPartnerDirectory(owners[0])).length, 0);
    await guest(application.id, partnerKey, {
      action: "set_availability",
      availability: "limited",
    });
    await assert.rejects(
      staff(receipt.id, { action: "assign_partner", partnerId: application.id }),
    );
    const assignmentKey = key();
    const assignment = await createStudioRequest(
      token,
      contract,
      StudioIntake.parse({
        ...input,
        requestId: randomUUID(),
        accessKey: assignmentKey,
        target: "partner",
      }),
    );
    await staff(assignment.id, { action: "assign_partner", partnerId: application.id });
    const assignments = (await getStudioPortal(application.id, partnerKey))!.assignments;
    assert.deepEqual(
      assignments.map((r) => r.id),
      [assignment.id],
    );
    assert.equal(JSON.stringify(assignments).includes(ownedProject.id), false);
    await assert.rejects(
      guest(application.id, partnerKey, {
        action: "deliver_assignment",
        requestId: receipt.id,
        expectedVersion: 2,
        previewUrl: "https://bitbaum.orangecat.ch",
        scope: "Attempt at unrelated request",
        summary: "This unrelated request must remain inaccessible.",
      }),
    );
    const delivery = StudioGuestAction.parse({
      action: "deliver_assignment",
      mutationId: randomUUID(),
      requestId: assignment.id,
      expectedVersion: 0,
      previewUrl: "https://bitbaum.orangecat.ch",
      scope: "The assigned customer journey",
      summary: "Verified assigned delivery and handover evidence.",
    });
    await mutateStudioPortal(application.id, partnerKey, delivery);
    await mutateStudioPortal(application.id, partnerKey, delivery);
    assert.equal(
      (await getStudioPortal(assignment.id, assignmentKey))!.request.delivery!.version,
      1,
    );
    await staff(application.id, {
      action: "decline_partner",
      body: "Approval withdrawn for test review reasons.",
    });
    assert.equal((await getStudioPortal(application.id, partnerKey))!.assignments.length, 0);
    assert.equal((await studioPartnerDirectory(owners[0])).length, 0);
    await guest(application.id, partnerKey, { action: "submit_assessment", assessment }); // revision after decline is possible
    await staff(receipt.id, { action: "revoke_access" });
    assert.equal(await getStudioPortal(receipt.id, access), null);
    assert.equal(
      await guest(receipt.id, access, { action: "message", body: "Revoked capability" }),
      false,
    );
    await assert.rejects(createStudioRequest(token, contract, input));
    const sameTenant = await db
      .select()
      .from(studioRequests)
      .where(and(eq(studioRequests.userId, owners[0]), eq(studioRequests.id, receipt.id)));
    assert.equal(sameTenant.length, 1);
    console.log(
      "✓ studio-portal-e2e: real database dedupe, tenant isolation, exact-version review, course/approval separation, availability, assigned delivery and revocation",
    );
  } finally {
    await db.delete(entities).where(inArray(entities.userId, owners));
    await db.delete(users).where(inArray(users.id, owners));
  }
}
main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
