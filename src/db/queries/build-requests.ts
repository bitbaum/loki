import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { buildRequests, users, type BuildRequest, type BuildRequestLook } from "@/db/schema";
import { BUILD_REQUESTS } from "@/config/build-requests";

/**
 * File a new account's build for the operator (config/build-requests). The
 * brief's request id makes a repeat — a double tap, a retry after a network
 * blip — return the request already filed, never a second one.
 */
export async function fileBuildRequest(input: {
  userId: string;
  requestId: string;
  website: string;
  brief: Record<string, unknown>;
  look: BuildRequestLook | null;
}): Promise<{ row: BuildRequest; fresh: boolean }> {
  const [inserted] = await db
    .insert(buildRequests)
    .values(input)
    .onConflictDoNothing({ target: [buildRequests.userId, buildRequests.requestId] })
    .returning();
  if (inserted) return { row: inserted, fresh: true };
  const [existing] = await db
    .select()
    .from(buildRequests)
    .where(
      and(eq(buildRequests.userId, input.userId), eq(buildRequests.requestId, input.requestId)),
    )
    .limit(1);
  return { row: existing!, fresh: false };
}

/** One request, only for the account that filed it. */
export async function getOwnBuildRequest(userId: string, id: string): Promise<BuildRequest | null> {
  const [row] = await db
    .select()
    .from(buildRequests)
    .where(and(eq(buildRequests.id, id), eq(buildRequests.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getBuildRequest(id: string): Promise<BuildRequest | null> {
  const [row] = await db.select().from(buildRequests).where(eq(buildRequests.id, id)).limit(1);
  return row ?? null;
}

export type BuildRequestListItem = BuildRequest & { email: string | null };

/** What the operator decides on: waiting first, then the latest decided ones. */
export async function listBuildRequests(): Promise<BuildRequestListItem[]> {
  const rows = await db
    .select({ request: buildRequests, email: users.email })
    .from(buildRequests)
    .innerJoin(users, eq(users.id, buildRequests.userId))
    .orderBy(desc(buildRequests.createdAt))
    .limit(BUILD_REQUESTS.listLimit);
  const items = rows.map((r) => ({ ...r.request, email: r.email }));
  return [
    ...items.filter((r) => r.status === "waiting"),
    ...items.filter((r) => r.status !== "waiting"),
  ];
}

/**
 * Take a waiting request for a decision. Exactly one caller wins: two taps on
 * Approve must not start two builds, and an Approve racing a Decline must not
 * do both. Null when it was not waiting.
 */
export async function claimBuildRequest(
  id: string,
  to: "building" | "declined",
  note: string | null,
): Promise<BuildRequest | null> {
  const [row] = await db
    .update(buildRequests)
    .set({ status: to, note, decidedAt: new Date() })
    .where(and(eq(buildRequests.id, id), eq(buildRequests.status, "waiting")))
    .returning();
  return row ?? null;
}

/** An approval whose build could not start goes back to waiting, untouched. */
export async function reopenBuildRequest(id: string): Promise<void> {
  await db
    .update(buildRequests)
    .set({ status: "waiting", note: null, decidedAt: null })
    .where(and(eq(buildRequests.id, id), inArray(buildRequests.status, ["building"])));
}

/** Where the approved build lives, once it exists. */
export async function recordBuildRequestPreview(
  id: string,
  preview: { projectId: string | null; previewUrl: string | null; accessCode: string | null },
): Promise<void> {
  await db.update(buildRequests).set(preview).where(eq(buildRequests.id, id));
}
