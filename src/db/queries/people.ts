import { DEFAULT_USER_EXTERNAL_ID, SOURCE_LOKI_UI } from "@/lib/constants";
import {
  ENTITY_TYPE,
  SORT_MODE,
  type InteractionDirection,
  type SortMode,
} from "@/lib/constants/statuses";
import { db } from "@/db";
import { entities, attributes, entityRelations, interactions } from "@/db/schema";
import { eq, and, sql, desc, inArray, type SQL } from "drizzle-orm";
import { fetchAttributesByEntityIds } from "./utils";
import { escapeLike } from "@/lib/sql-escape";
import { forgivenPersonIds, rankPeople, type PersonNameRow } from "@/lib/people-search";
import {
  deriveRelationshipHealth,
  type RelationshipHealth,
  HEALTH_ACTIVE_DAYS,
  HEALTH_FADING_DAYS,
} from "@/lib/constants/people";
import { z } from "zod";

export type PersonWithAttributes = {
  id: string;
  name: string;
  externalId: string | null;
  description: string | null;
  source: string | null;
  attrs: Record<string, string>;
  lastInteraction: Date | null;
  interactionCount: number;
  relationCount: number;
  health: RelationshipHealth;
};

// Re-export so existing `import { SORT_MODE } from "@/db/queries/people"`
// callers keep working — but the canonical home is lib/constants/statuses,
// and client components should import from there.
export { SORT_MODE, type SortMode };

export const CreatePersonBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  description: z.string().trim().optional(),
  source: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
});

export type CreatePersonInput = z.infer<typeof CreatePersonBody>;

export const PatchPersonBody = z
  .object({
    name: z.string().trim().min(1, "name cannot be empty").optional(),
    description: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

// Build HAVING clause for health filtering — all health values are enum literals, not user input
function buildHealthHaving(health: RelationshipHealth[]): SQL {
  const clauses: SQL[] = [];
  if (health.includes("active"))
    clauses.push(sql`max(i.occurred_at) >= now() - make_interval(days => ${HEALTH_ACTIVE_DAYS})`);
  if (health.includes("fading"))
    clauses.push(
      sql`max(i.occurred_at) BETWEEN now() - make_interval(days => ${HEALTH_FADING_DAYS}) AND now() - make_interval(days => ${HEALTH_ACTIVE_DAYS})`,
    );
  if (health.includes("stale"))
    clauses.push(sql`max(i.occurred_at) < now() - make_interval(days => ${HEALTH_FADING_DAYS})`);
  if (health.includes("unknown")) clauses.push(sql`max(i.occurred_at) IS NULL`);
  if (clauses.length === 0) return sql``;
  return sql`HAVING (${sql.join(clauses, sql` OR `)})`;
}

/** Every person's id, name and aliases — the vocabulary a typo is forgiven against. */
async function loadPersonNames(userId: string): Promise<PersonNameRow[]> {
  return db.execute<PersonNameRow>(sql`
    SELECT e.id, e.name, a.value AS aliases
    FROM entities e
    LEFT JOIN attributes a ON a.entity_id = e.id AND a.key = 'aliases'
    WHERE e.user_id = ${userId} AND e.type = ${ENTITY_TYPE.PERSON}
  `);
}

export async function searchPeople(
  userId: string,
  query: string,
  limit = 50,
  offset = 0,
  sort: SortMode = SORT_MODE.RECENT,
  health: RelationshipHealth[] = [],
  /**
   * The search box (`/api/people`): also find names one slip away, and put
   * the best match first. Off for the assistant's lookups on purpose — they
   * pick ONE person to message or describe, and a forgiven "Jon" there could
   * quietly become the wrong John.
   */
  { forgiveTypos = false }: { forgiveTypos?: boolean } = {},
): Promise<{ people: PersonWithAttributes[]; total: number }> {
  // User input — parameterized via sql tagged template (never string-interpolated)
  const q = query.trim();
  const like = q ? "%" + escapeLike(q) + "%" : "";
  // Ids ILIKE cannot reach ("jonh" → John), best match first.
  const forgiven = q && forgiveTypos ? forgivenPersonIds(await loadPersonNames(userId), q) : [];
  const forgivenIds = forgiven.length
    ? sql`ARRAY[${sql.join(
        forgiven.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`
    : null;
  const nameFilter: SQL = q
    ? sql`AND (
        e.name ILIKE ${like}
        ${forgivenIds ? sql`OR e.id = ANY(${forgivenIds})` : sql``}
        OR EXISTS (
          SELECT 1 FROM attributes a
          WHERE a.entity_id = e.id AND a.user_id = ${userId}
            AND (
              (a.key = 'aliases' AND a.value ILIKE ${like})
              OR (a.key LIKE 'channel:%' AND a.value ILIKE ${like})
              OR (a.key IN ('company','profession','location','relationship') AND a.value ILIKE ${like})
            )
        )
      )`
    : sql``;
  const having: SQL = buildHealthHaving(health);

  const sortBy: SQL =
    sort === "name"
      ? sql`e.name ASC`
      : sort === "health"
        ? sql`last_interaction ASC NULLS FIRST`
        : sql`last_interaction DESC NULLS LAST`;
  // With a typed name, the people it names lead — so the one meant is on the
  // first page — and the chosen sort orders everyone else.
  const orderBy: SQL = forgivenIds
    ? sql`array_position(${forgivenIds}, e.id) ASC NULLS LAST, ${sortBy}`
    : sortBy;

  const [countResult, rows] = await Promise.all([
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count FROM (
        SELECT e.id
        FROM entities e
        LEFT JOIN interactions i ON i.entity_id = e.id
        WHERE e.user_id = ${userId} AND e.type = ${ENTITY_TYPE.PERSON} AND (e.external_id IS NULL OR e.external_id != ${DEFAULT_USER_EXTERNAL_ID})
        ${nameFilter}
        GROUP BY e.id
        ${having}
      ) sub
    `),
    db.execute<{
      id: string;
      name: string;
      external_id: string | null;
      description: string | null;
      source: string | null;
      last_interaction: Date | null;
      interaction_count: string;
      relation_count: string;
    }>(sql`
      SELECT e.id, e.name, e.external_id, e.description, e.source,
             max(i.occurred_at) as last_interaction,
             count(DISTINCT i.id)::text as interaction_count,
             (SELECT count(*) FROM entity_relations r
              WHERE r.from_entity_id = e.id OR r.to_entity_id = e.id)::text as relation_count
      FROM entities e
      LEFT JOIN interactions i ON i.entity_id = e.id
      WHERE e.user_id = ${userId} AND e.type = ${ENTITY_TYPE.PERSON} AND (e.external_id IS NULL OR e.external_id != ${DEFAULT_USER_EXTERNAL_ID})
      ${nameFilter}
      GROUP BY e.id
      ${having}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const peopleIds = rows.map((r) => r.id);
  const attrsByEntity = await fetchAttributesByEntityIds(peopleIds);

  const people = rows.map((r): PersonWithAttributes => {
    const lastInteraction = r.last_interaction ? new Date(r.last_interaction) : null;
    return {
      id: r.id,
      name: r.name,
      externalId: r.external_id,
      description: r.description,
      source: r.source,
      attrs: attrsByEntity.get(r.id) ?? {},
      lastInteraction,
      interactionCount: Number(r.interaction_count),
      relationCount: Number(r.relation_count),
      health: deriveRelationshipHealth(lastInteraction),
    };
  });

  return {
    people: forgiveTypos ? rankPeople(people, q) : people,
    total: Number(countResult[0].count),
  };
}

/** Lightweight contact facts for the action queue — not the full dossier. */
export type PersonSummary = {
  id: string;
  name: string;
  description: string | null;
  attrs: Record<string, string>;
  lastInteraction: Date | null;
};

export async function getPeopleSummaries(
  userId: string,
  ids: string[],
): Promise<Map<string, PersonSummary>> {
  const out = new Map<string, PersonSummary>();
  if (ids.length === 0) return out;

  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      description: entities.description,
    })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.type, ENTITY_TYPE.PERSON),
        inArray(entities.id, ids),
      ),
    );

  const [attrsByEntity, lastByEntity] = await Promise.all([
    fetchAttributesByEntityIds(rows.map((r) => r.id)),
    db
      .select({
        entityId: interactions.entityId,
        last: sql<Date>`max(${interactions.occurredAt})`,
      })
      .from(interactions)
      .where(and(eq(interactions.userId, userId), inArray(interactions.entityId, ids)))
      .groupBy(interactions.entityId),
  ]);

  const lastMap = new Map(lastByEntity.map((r) => [r.entityId, r.last ? new Date(r.last) : null]));
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      name: r.name,
      description: r.description,
      attrs: attrsByEntity.get(r.id) ?? {},
      lastInteraction: lastMap.get(r.id) ?? null,
    });
  }
  return out;
}

export async function getPersonDetail(userId: string, id: string) {
  const [person] = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PERSON)),
    );

  if (!person) return null;

  // Person ownership is verified above. The joined `entities` tables and the
  // interactions/attributes queries also filter by userId — defense-in-depth
  // against any stray row whose entity_id outlives its owning user.
  const [attrs, relationsFrom, relationsTo, recentInteractions] = await Promise.all([
    db
      .select()
      .from(attributes)
      .where(and(eq(attributes.entityId, id), eq(attributes.userId, userId))),
    db
      .select({
        type: entityRelations.type,
        strength: entityRelations.strength,
        targetId: entityRelations.toEntityId,
        targetName: entities.name,
        targetType: entities.type,
      })
      .from(entityRelations)
      .innerJoin(
        entities,
        and(eq(entities.id, entityRelations.toEntityId), eq(entities.userId, userId)),
      )
      .where(eq(entityRelations.fromEntityId, id)),
    db
      .select({
        type: entityRelations.type,
        strength: entityRelations.strength,
        targetId: entityRelations.fromEntityId,
        targetName: entities.name,
        targetType: entities.type,
      })
      .from(entityRelations)
      .innerJoin(
        entities,
        and(eq(entities.id, entityRelations.fromEntityId), eq(entities.userId, userId)),
      )
      .where(eq(entityRelations.toEntityId, id)),
    db
      .select()
      .from(interactions)
      .where(and(eq(interactions.entityId, id), eq(interactions.userId, userId)))
      .orderBy(desc(interactions.occurredAt))
      .limit(10),
  ]);

  return {
    ...person,
    attrs: Object.fromEntries(attrs.map((a) => [a.key, a.value])),
    relations: [...relationsFrom, ...relationsTo],
    interactions: recentInteractions,
  };
}

export async function createPerson(
  userId: string,
  { name, description, source, externalId }: CreatePersonInput,
) {
  const [created] = await db
    .insert(entities)
    .values({
      userId,
      name,
      type: ENTITY_TYPE.PERSON,
      description: description || null,
      source: source || SOURCE_LOKI_UI,
      externalId: externalId || null,
    })
    .returning({ id: entities.id, name: entities.name });
  return created;
}

export async function patchPerson(
  userId: string,
  id: string,
  data: z.infer<typeof PatchPersonBody>,
) {
  const patch: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description.trim() || null;
  const [updated] = await db
    .update(entities)
    .set(patch)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PERSON)),
    )
    .returning({ id: entities.id });
  return updated ?? null;
}

export async function deletePerson(userId: string, id: string) {
  const [deleted] = await db
    .delete(entities)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PERSON)),
    )
    .returning({ id: entities.id });
  return deleted ?? null;
}

export async function createInteraction(
  userId: string,
  {
    entityId,
    channel,
    direction,
    summary,
    occurredAt,
  }: {
    entityId: string;
    channel: string;
    direction: InteractionDirection;
    summary?: string | null;
    occurredAt?: Date;
  },
) {
  const [created] = await db
    .insert(interactions)
    .values({
      userId,
      entityId,
      channel,
      direction,
      summary: summary ?? null,
      occurredAt: occurredAt ?? new Date(),
    })
    .returning();
  return created;
}
