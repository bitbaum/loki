import { SOURCE_LOKI_UI } from "@/lib/constants";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import {
  CreateRobotBody,
  DEFAULT_VACUUMS,
  MARKET_ATTR,
  MARKET_OFFERS,
  PatchRobotBody,
  ROBOT_ATTR,
  ROBOT_CLASS,
  assertCanMarket,
  parseMarketFlags,
  parseRobotClass,
  type CreateRobotInput,
  type MarketOffer,
  type RobotClass,
} from "@/config/actors";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { fetchAttributesByEntityIds, upsertEntityAttribute, deleteEntityAttribute } from "./utils";
import { escapeLike } from "@/lib/sql-escape";
import type { z } from "zod";

export { CreateRobotBody, PatchRobotBody, type CreateRobotInput };

export type RobotWithAttributes = {
  id: string;
  name: string;
  description: string | null;
  source: string | null;
  updatedAt: Date;
  attrs: Record<string, string>;
  robotClass: RobotClass | null;
  make: string | null;
  model: string | null;
  market: Record<MarketOffer, boolean>;
  orangecatAssetId: string | null;
  listing?: { assetId: string | null; published: boolean; reason?: string };
};

function hydrate(row: {
  id: string;
  name: string;
  description: string | null;
  source: string | null;
  updatedAt: Date;
  attrs: Record<string, string>;
}): RobotWithAttributes {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    updatedAt: row.updatedAt,
    attrs: row.attrs,
    robotClass: parseRobotClass(row.attrs),
    make: row.attrs[ROBOT_ATTR.MAKE] || null,
    model: row.attrs[ROBOT_ATTR.MODEL] || null,
    market: parseMarketFlags(row.attrs),
    orangecatAssetId: row.attrs[ROBOT_ATTR.ORANGECAT_ASSET_ID] || null,
  };
}

export async function searchRobots(
  userId: string,
  query: string,
  limit = 50,
  offset = 0,
): Promise<{ robots: RobotWithAttributes[]; total: number }> {
  // Not searchkit: a household's robots are a handful of rows the grid shows
  // whole; there is nothing for typo tolerance to recover.
  const nameFilter: SQL = query.trim()
    ? sql`AND e.name ILIKE ${"%" + escapeLike(query.trim()) + "%"}`
    : sql``;

  const [countResult, rows] = await Promise.all([
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count
      FROM entities e
      WHERE e.user_id = ${userId} AND e.type = ${ENTITY_TYPE.ROBOT}
      ${nameFilter}
    `),
    db.execute<{
      id: string;
      name: string;
      description: string | null;
      source: string | null;
      updated_at: Date;
    }>(sql`
      SELECT e.id, e.name, e.description, e.source, e.updated_at
      FROM entities e
      WHERE e.user_id = ${userId} AND e.type = ${ENTITY_TYPE.ROBOT}
      ${nameFilter}
      ORDER BY e.updated_at DESC, e.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const attrsByEntity = await fetchAttributesByEntityIds(rows.map((r) => r.id));
  return {
    robots: rows.map((r) =>
      hydrate({
        id: r.id,
        name: r.name,
        description: r.description,
        source: r.source,
        updatedAt: r.updated_at ? new Date(r.updated_at) : new Date(0),
        attrs: attrsByEntity.get(r.id) ?? {},
      }),
    ),
    total: Number(countResult[0].count),
  };
}

export async function getRobotDetail(
  userId: string,
  id: string,
): Promise<RobotWithAttributes | null> {
  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      description: entities.description,
      source: entities.source,
      updatedAt: entities.updatedAt,
    })
    .from(entities)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.ROBOT)),
    );

  if (!row) return null;

  const attrsByEntity = await fetchAttributesByEntityIds([row.id]);
  return hydrate({
    ...row,
    attrs: attrsByEntity.get(row.id) ?? {},
  });
}

async function writeRobotAttrs(
  userId: string,
  entityId: string,
  data: {
    class?: RobotClass;
    make?: string | null;
    model?: string | null;
    market?: { book?: boolean; rent?: boolean; sell?: boolean };
  },
) {
  assertCanMarket(ENTITY_TYPE.ROBOT);
  if (data.class) {
    await upsertEntityAttribute(userId, entityId, ROBOT_ATTR.CLASS, data.class);
  }
  if (data.make !== undefined) {
    if (data.make) await upsertEntityAttribute(userId, entityId, ROBOT_ATTR.MAKE, data.make);
    else await deleteEntityAttribute(userId, entityId, ROBOT_ATTR.MAKE);
  }
  if (data.model !== undefined) {
    if (data.model) await upsertEntityAttribute(userId, entityId, ROBOT_ATTR.MODEL, data.model);
    else await deleteEntityAttribute(userId, entityId, ROBOT_ATTR.MODEL);
  }
  if (data.market) {
    for (const offer of MARKET_OFFERS) {
      const flag = data.market[offer];
      if (flag === undefined) continue;
      if (flag) await upsertEntityAttribute(userId, entityId, MARKET_ATTR[offer], "true");
      else await deleteEntityAttribute(userId, entityId, MARKET_ATTR[offer]);
    }
  }
}

export async function createRobot(userId: string, input: CreateRobotInput) {
  assertCanMarket(ENTITY_TYPE.ROBOT);
  const [created] = await db
    .insert(entities)
    .values({
      userId,
      name: input.name,
      type: ENTITY_TYPE.ROBOT,
      description: input.description || null,
      source: SOURCE_LOKI_UI,
    })
    .returning({ id: entities.id, name: entities.name });

  await writeRobotAttrs(userId, created.id, {
    class: input.class,
    make: input.make || null,
    model: input.model || null,
    market: input.market,
  });

  const detail = await getRobotDetail(userId, created.id);
  return detail ?? created;
}

export async function patchRobot(userId: string, id: string, data: z.infer<typeof PatchRobotBody>) {
  const existing = await getRobotDetail(userId, id);
  if (!existing) return null;

  const patch: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description.trim() || null;

  const [updated] = await db
    .update(entities)
    .set(patch)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.ROBOT)),
    )
    .returning({ id: entities.id });
  if (!updated) return null;

  await writeRobotAttrs(userId, id, {
    class: data.class,
    make: data.make,
    model: data.model,
    market: data.market,
  });

  const detail = await getRobotDetail(userId, id);
  if (!detail) return null;
  if (detail.market.book || detail.market.rent || detail.market.sell) {
    const { publishRobotAsset } = await import("@/lib/integrations/orangecat-asset");
    const listing = await publishRobotAsset(userId, detail);
    const next = await getRobotDetail(userId, id);
    if (next) next.listing = listing;
    return next;
  }
  return detail;
}

export async function ensureDefaultVacuums(userId: string): Promise<RobotWithAttributes[]> {
  const created: RobotWithAttributes[] = [];
  for (const spec of DEFAULT_VACUUMS) {
    const existing = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.type, ENTITY_TYPE.ROBOT),
          eq(entities.name, spec.name),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const detail = await getRobotDetail(userId, existing[0].id);
      if (detail) created.push(detail);
      continue;
    }
    const robot = await createRobot(userId, {
      name: spec.name,
      class: ROBOT_CLASS.VACUUM,
      description: spec.description,
    });
    const detail = await getRobotDetail(userId, robot.id);
    if (detail) created.push(detail);
  }
  return created;
}

export async function deleteRobot(userId: string, id: string) {
  const [deleted] = await db
    .delete(entities)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.ROBOT)),
    )
    .returning({ id: entities.id });
  return deleted ?? null;
}
