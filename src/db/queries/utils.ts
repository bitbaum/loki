import { db } from "@/db";
import { attributes, entities, interactions, orgMemberships, type Interaction } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, ne } from "drizzle-orm";
import { SOURCE_LOKI_UI } from "@/lib/constants";
import { INTERACTION_DIRECTION, type InteractionDirection } from "@/lib/constants/statuses";
import { assertAttrAllowed } from "@/config/actors";
import { z } from "zod";

/** Shared validator for the two `/api/<entity>/[id]/interactions` POST routes. */
const DIRECTIONS = Object.values(INTERACTION_DIRECTION) as [
  InteractionDirection,
  ...InteractionDirection[],
];
export const CreateInteractionBody = z.object({
  channel: z.string().trim().min(1, "channel is required"),
  direction: z.enum(DIRECTIONS, { error: "direction must be inbound or outbound" }),
  summary: z.string().trim().optional(),
  occurredAt: z.string().optional(),
});

/** Shared validators for the two `/api/<entity>/[id]/attrs` routes. */
export const SetAttrBody = z.object({
  key: z.string().trim().min(1, "key and value required"),
  value: z.string().trim().min(1, "key and value required"),
});
export const DeleteAttrBody = z.object({
  key: z.string().trim().min(1, "key required"),
});

/**
 * Returns distinct userIds of other members who share at least one org with this user.
 * Single self-join query — callers use it to scope lookups to org peers.
 */
export async function getOrgPeerIds(userId: string): Promise<string[]> {
  const m2 = alias(orgMemberships, "m2");
  const rows = await db
    .selectDistinct({ userId: m2.userId })
    .from(orgMemberships)
    .innerJoin(m2, eq(orgMemberships.orgId, m2.orgId))
    .where(and(eq(orgMemberships.userId, userId), ne(m2.userId, userId)));
  return rows.map((r) => r.userId);
}

/**
 * When an attribute was last written, by what, and when it stops being true.
 *
 * The row already carries this — `select()` pulls every column — and the
 * grouping loop below used to drop all of it on the floor, keeping only
 * key → value. So a flag like `security_vulnerability` reached the UI as a
 * bare sentence with no date and no author, which is why a note typed months
 * ago could pin a project to the top of the list forever and nobody could tell
 * how old it was. Nothing extra is queried to return it.
 */
export type AttributeMeta = {
  value: string;
  updatedAt: string;
  source: string | null;
  validUntil: string | null;
};

/** key → value, from an already-fetched meta map. No second query. */
export function attrValuesFromMeta(
  meta: Record<string, AttributeMeta> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, m] of Object.entries(meta ?? {})) out[key] = m.value;
  return out;
}

export async function fetchAttributesWithMetaByEntityIds(
  entityIds: string[],
): Promise<Map<string, Record<string, AttributeMeta>>> {
  if (entityIds.length === 0) return new Map();

  const allAttrs = await db
    .select()
    .from(attributes)
    .where(inArray(attributes.entityId, entityIds));

  const grouped = new Map<string, Record<string, AttributeMeta>>();
  for (const attr of allAttrs) {
    const existing = grouped.get(attr.entityId) ?? {};
    existing[attr.key] = {
      value: attr.value,
      updatedAt: (attr.updatedAt ?? attr.createdAt).toISOString(),
      source: attr.source ?? null,
      validUntil: attr.validUntil ? attr.validUntil.toISOString() : null,
    };
    grouped.set(attr.entityId, existing);
  }
  return grouped;
}

export async function fetchAttributesByEntityIds(
  entityIds: string[],
): Promise<Map<string, Record<string, string>>> {
  if (entityIds.length === 0) return new Map();

  const allAttrs = await db
    .select()
    .from(attributes)
    .where(inArray(attributes.entityId, entityIds));

  const grouped = new Map<string, Record<string, string>>();
  for (const attr of allAttrs) {
    const existing = grouped.get(attr.entityId) ?? {};
    existing[attr.key] = attr.value;
    grouped.set(attr.entityId, existing);
  }
  return grouped;
}

/** Verifies the entity belongs to the user before upserting an attribute.
 *  Returns false if the entity wasn't found (caller should 404). */
export async function upsertEntityAttribute(
  userId: string,
  entityId: string,
  key: string,
  value: string,
): Promise<boolean> {
  const [owner] = await db
    .select({ id: entities.id, type: entities.type })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.userId, userId)));
  if (!owner) return false;

  const normalizedKey = key.toLowerCase().replace(/\s+/g, "_");
  assertAttrAllowed(owner.type, normalizedKey);

  await db
    .insert(attributes)
    .values({
      userId,
      entityId,
      key: normalizedKey,
      value,
      source: SOURCE_LOKI_UI,
    })
    .onConflictDoUpdate({
      target: [attributes.userId, attributes.entityId, attributes.key],
      set: { value, updatedAt: new Date() },
    });
  return true;
}

/** Deletes the (entity, key) attribute for the current user. */
export async function deleteEntityAttribute(
  userId: string,
  entityId: string,
  key: string,
): Promise<void> {
  await db
    .delete(attributes)
    .where(
      and(
        eq(attributes.entityId, entityId),
        eq(attributes.key, key),
        eq(attributes.userId, userId),
      ),
    );
}

/** Verifies the entity belongs to the user before recording an interaction.
 *  Returns the created row, or null if the entity wasn't found (caller should 404). */
export async function createEntityInteraction(
  userId: string,
  entityId: string,
  body: { channel: string; direction: InteractionDirection; summary?: string; occurredAt?: string },
): Promise<Interaction | null> {
  const [owner] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.userId, userId)));
  if (!owner) return null;

  const [created] = await db
    .insert(interactions)
    .values({
      userId,
      entityId,
      channel: body.channel,
      direction: body.direction,
      summary: body.summary || null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    })
    .returning();
  return created;
}
