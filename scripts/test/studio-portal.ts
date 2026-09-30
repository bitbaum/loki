import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { StudioIntake, StudioGuestAction, StudioStaffAction } from "../../src/config/studio";
import { COMMISSION } from "../../src/config/commission";
import {
  studioHash,
  studioKeyMatches,
  studioBearer,
  studioHeaders,
  studioOriginAllowed,
} from "../../src/lib/studio/access";
import { readStudioBody, StudioBodyTooLarge } from "../../src/lib/studio/body";
import {
  requireCurrentPreview,
  requireDeliveryVersion,
  validateCourseEvidence,
} from "../../src/lib/studio/policy";
import { StudioContract } from "../../src/lib/studio-commission";
import { studioView } from "../../src/lib/studio/projection";
import type { StudioRequest } from "../../src/db/schema/studio-requests";
async function main() {
  const key = `spt_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const base = {
    kind: "website",
    target: "studio",
    website: "bitbaum.orangecat.ch",
    changes: "Make booking easier",
    requestId: id,
    accessKey: key,
    offerId: "rescue",
  };
  assert.equal(StudioIntake.parse(base).website, "https://bitbaum.orangecat.ch/");
  for (const extra of [{ userId: id }, { projectId: id }, { tokenId: id }, { status: "approved" }])
    assert.equal(StudioIntake.safeParse({ ...base, ...extra }).success, false);
  for (const website of [
    "localhost",
    "http://127.0.0.1",
    "https://10.0.0.1",
    "https://user:pass@bitbaum.orangecat.ch",
    "file:///etc/passwd",
    "https://bitbaum.orangecat.ch:8080",
  ])
    assert.equal(StudioIntake.safeParse({ ...base, website }).success, false);
  assert.ok(studioKeyMatches(key, studioHash(key)));
  assert.equal(
    studioKeyMatches(`spt_${randomBytes(32).toString("base64url")}`, studioHash(key)),
    false,
  );
  assert.equal(
    studioBearer(
      new Request("https://loki.orangecat.ch", { headers: { Authorization: `Bearer ${key}` } }),
    ),
    key,
  );
  assert.equal(studioBearer(new Request(`https://loki.orangecat.ch?key=${key}`)), null);
  const origin = new Request("https://loki.orangecat.ch", {
    headers: { Origin: COMMISSION.studioOrigin },
  });
  assert.ok(studioOriginAllowed(origin, true));
  assert.equal(studioHeaders(origin).get("Access-Control-Allow-Origin"), COMMISSION.studioOrigin);
  assert.equal(studioHeaders(origin).get("Access-Control-Allow-Credentials"), null);
  const foreign = new Request("https://loki.orangecat.ch", {
    headers: { Origin: "https://other.ch" },
  });
  assert.equal(studioOriginAllowed(foreign), false);
  assert.equal(studioHeaders(foreign).get("Access-Control-Allow-Origin"), null);
  assert.equal(
    StudioGuestAction.safeParse({ action: "link_project", mutationId: id, projectId: id }).success,
    false,
  );
  assert.equal(
    StudioGuestAction.safeParse({
      action: "approve_partner",
      mutationId: id,
      body: "Approve partner",
    }).success,
    false,
  );
  assert.equal(
    StudioStaffAction.safeParse({
      action: "publish_preview",
      mutationId: id,
      expectedVersion: 0,
      previewUrl: "javascript:alert(1)",
      scope: "Example scope",
      summary: "Example summary",
    }).success,
    false,
  );
  const preview = {
    kind: "website",
    status: "ready_for_review",
    deliveryVersion: 2,
    previewUrl: "https://bitbaum.orangecat.ch",
  };
  assert.doesNotThrow(() => requireCurrentPreview(preview, 2));
  assert.throws(() => requireCurrentPreview(preview, 1));
  assert.throws(() => requireCurrentPreview({ ...preview, status: "closed" }, 2));
  assert.throws(() => requireDeliveryVersion(2, 1));
  const contract = StudioContract.parse({
    version: 1,
    origin: COMMISSION.studioOrigin,
    availability: { state: "closed", line: "Closed" },
    offer: {
      id: "rescue",
      name: "Rescue",
      price: "CHF 6,500",
      shape: "Two weeks",
      what: "Assessment",
    },
    feedbackToken: "fcw_test",
    course: {
      version: "pilot-v1",
      title: "Pilot",
      pilot: true,
      modules: [{ id: "problem-constraints", title: "Problem" }],
    },
  });
  const assessment = {
    version: "pilot-v1",
    answers: { "problem-constraints": "A concrete outcome and meaningful evidence." },
    projectUrl: "https://bitbaum.orangecat.ch",
    sourceUrl: "https://github.com/bitbaum/bitbaum",
  };
  validateCourseEvidence(assessment, contract);
  assert.throws(() => validateCourseEvidence({ ...assessment, version: "old" }, contract));
  assert.throws(() => validateCourseEvidence({ ...assessment, answers: {} }, contract));
  const row = {
    id,
    kind: "website",
    target: "studio",
    website: base.website,
    changes: base.changes,
    offerSnapshot: contract.offer,
    status: "ready_for_review",
    createdAt: new Date(),
    updatedAt: new Date(),
    deliveryVersion: 2,
    previewUrl: preview.previewUrl,
    scope: "Example scope",
    deliverySummary: "Summary",
    approvedVersion: 1,
    userId: "PRIVATE_OWNER",
    contact: "private@other.ch",
    accessKeyHash: studioHash(key),
    projectId: "PRIVATE_PROJECT",
  } as unknown as StudioRequest;
  const view = studioView(row, []);
  assert.equal(view.delivery?.accepted, false);
  const serialized = JSON.stringify(view);
  for (const secret of [
    key,
    studioHash(key),
    "PRIVATE_OWNER",
    "PRIVATE_PROJECT",
    "private@other.ch",
  ])
    assert.equal(serialized.includes(secret), false);
  const body = new Request("https://loki.orangecat.ch", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await readStudioBody(body), { ok: true });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(32_001)));
      controller.close();
    },
  });
  await assert.rejects(
    readStudioBody(
      new Request("https://loki.orangecat.ch", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    ),
    StudioBodyTooLarge,
  );
  console.log(
    "✓ studio-portal: strict inputs, scoped keys, CORS, bounded body, course version, exact preview and private projection",
  );
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
