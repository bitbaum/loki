import { EVENTS_DUE_SOON_DAYS } from "@/lib/constants";
import { EVENT_STATUS, type EventStatus } from "@/lib/constants/statuses";
import { db } from "@/db";
import { events, type EventRow } from "@/db/schema";
import { eq, asc, and, lte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

export type { EventRow };

const EVENT_STATUSES = Object.values(EVENT_STATUS) as [EventStatus, ...EventStatus[]];

export const CreateEventBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  type: z.string().trim().min(1, "type is required"),
  description: z.string().trim().optional(),
  url: z.string().trim().optional(),
  // An empty date field means "no deadline", not a bad date: the add form
  // sent "" for it and every event without a deadline was refused.
  deadline: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date")
      .optional(),
  ),
  category: z.string().trim().optional(),
});

export const PatchEventBody = z
  .object({
    status: z.enum(EVENT_STATUSES, { error: "Invalid status" }).optional(),
    name: z.string().trim().min(1, "name cannot be empty").optional(),
    description: z.string().nullable().optional(),
    url: z.string().trim().nullable().optional(),
    deadline: z
      .string()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date")
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

type CreateEventInput = z.infer<typeof CreateEventBody>;
type PatchEventInput = z.infer<typeof PatchEventBody>;

export async function createEvent(userId: string, data: CreateEventInput, source?: string) {
  const [created] = await db
    .insert(events)
    .values({
      userId,
      name: data.name,
      type: data.type.toLowerCase(),
      description: data.description || null,
      url: data.url || null,
      deadline: data.deadline ? new Date(data.deadline) : null,
      category: data.category?.toLowerCase() || null,
      status: EVENT_STATUS.ACTIVE,
      source: source ?? null,
    })
    .returning();
  return created;
}

export async function patchEvent(userId: string, id: string, data: PatchEventInput) {
  const [updated] = await db
    .update(events)
    .set({
      ...(data.status !== undefined && { status: data.status }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.url !== undefined && { url: data.url }),
      ...(data.deadline !== undefined && {
        deadline: data.deadline ? new Date(data.deadline) : null,
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(events.id, id), eq(events.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteEvent(userId: string, id: string) {
  await db.delete(events).where(and(eq(events.id, id), eq(events.userId, userId)));
}

export async function getEventsDueSoon(
  userId: string,
  days = EVENTS_DUE_SOON_DAYS,
): Promise<EventRow[]> {
  const soon = new Date();
  soon.setDate(soon.getDate() + days);

  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.status, EVENT_STATUS.ACTIVE),
        isNotNull(events.deadline),
        lte(events.deadline, soon),
      ),
    )
    .orderBy(asc(events.deadline));
}

export async function getEvents(userId: string): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.status, EVENT_STATUS.ACTIVE)))
    .orderBy(
      sql`CASE WHEN ${events.deadline} IS NOT NULL THEN 0 ELSE 1 END`,
      asc(events.deadline),
      asc(events.name),
    );
}

export async function getArchivedEvents(userId: string): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.status, EVENT_STATUS.ARCHIVED)))
    .orderBy(
      sql`CASE WHEN ${events.deadline} IS NOT NULL THEN 0 ELSE 1 END`,
      asc(events.deadline),
      asc(events.name),
    );
}
