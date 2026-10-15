import { db } from "@/db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { userPreferences } from "@/db/schema";
import { embedText, embedTexts, toVectorLiteral, embeddingsEnabled } from "@/lib/rag/embeddings";

/**
 * Consent gate for the knowledge index. Only an explicit memory_enabled=false
 * turns indexing off — a missing preferences row or a failed read must never
 * silently disable it (an indexing gap is worse to debug than the toggle is
 * worth). Exported for tests.
 */
export async function memoryIndexingAllowed(userId: string): Promise<boolean> {
  try {
    const row = await db
      .select({ memoryEnabled: userPreferences.memoryEnabled })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);
    return row?.memoryEnabled !== false;
  } catch {
    return true;
  }
}

export type KnowledgeSourceType =
  | "project_profile"
  | "dev_log"
  | "goal"
  | "orchestration_outcome"
  | "decision"
  | "entity"
  | "commitment"
  | "thought"
  | "fleet_map"
  | "repo_doc";

export type KnowledgeItem = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  chunk: string;
  metadata?: Record<string, unknown>;
};

export type KnowledgeHit = {
  sourceType: string;
  sourceId: string;
  chunk: string;
  similarity: number;
  metadata: Record<string, unknown>;
};

/** Embed + upsert a batch of chunks for one user. Returns how many landed. */
export async function upsertKnowledgeBatch(
  userId: string,
  items: KnowledgeItem[],
): Promise<number> {
  if (!embeddingsEnabled() || items.length === 0) return 0;
  if (!(await memoryIndexingAllowed(userId))) return 0;
  const vecs = await embedTexts(items.map((i) => i.chunk));
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const vec = vecs[i];
    if (!vec) continue;
    const it = items[i];
    await db.execute(sql`
      INSERT INTO knowledge_embeddings (user_id, source_type, source_id, chunk, embedding, metadata, updated_at)
      VALUES (${userId}, ${it.sourceType}, ${it.sourceId}, ${it.chunk}, ${toVectorLiteral(vec)}::vector, ${JSON.stringify(it.metadata ?? {})}::jsonb, now())
      ON CONFLICT (user_id, source_type, source_id)
      DO UPDATE SET chunk = EXCLUDED.chunk, embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, updated_at = now()
    `);
    n++;
  }
  return n;
}

/** Convenience single-chunk upsert (embed-on-write callers). */
export async function upsertKnowledge(userId: string, item: KnowledgeItem): Promise<void> {
  await upsertKnowledgeBatch(userId, [item]);
}

/** Delete one owned knowledge source, used after a project is renamed. */
export async function deleteKnowledgeSource(
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM knowledge_embeddings
    WHERE user_id = ${userId} AND source_type = ${sourceType} AND source_id = ${sourceId}
  `);
}

/**
 * Prune a user's orphan rows: for the given owned source types, delete rows
 * whose sourceId is NOT in `keepIds`. The reindexer calls this AFTER a
 * successful upsert (insert-first, prune-after) so re-chunked ids and removed
 * projects/essays leave no orphans — WITHOUT ever emptying the index if the
 * embed step fails. Scoped to types so embed-on-write sources survive.
 */
export async function pruneKnowledgeToIds(
  userId: string,
  sourceTypes: KnowledgeSourceType[],
  keepIds: string[],
): Promise<void> {
  if (sourceTypes.length === 0) return;
  const typeArray = sql`ARRAY[${sql.join(
    sourceTypes.map((t) => sql`${t}`),
    sql`, `,
  )}]::text[]`;
  const keepClause = keepIds.length
    ? sql`AND source_id <> ALL(${sql`ARRAY[${sql.join(
        keepIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`})`
    : sql``;
  await db.execute(
    sql`DELETE FROM knowledge_embeddings WHERE user_id = ${userId} AND source_type = ANY(${typeArray}) ${keepClause}`,
  );
}

/**
 * Retrieve top-K fleet-knowledge chunks for a query, scoped to one user.
 * Cosine distance via pgvector `<=>`; similarity = 1 - distance. Hard-thresholded
 * so off-topic rows don't pollute injected context.
 */
export async function searchKnowledge(
  userId: string,
  query: string,
  opts?: { k?: number; minSimilarity?: number; sourceTypes?: KnowledgeSourceType[] },
): Promise<KnowledgeHit[]> {
  if (!embeddingsEnabled() || !query.trim()) return [];
  const vec = await embedText(query);
  if (!vec) return [];
  const lit = toVectorLiteral(vec);
  const k = opts?.k ?? 6;
  const minSim = opts?.minSimilarity ?? 0.3;
  const typeFilter = opts?.sourceTypes?.length
    ? sql`AND source_type = ANY(${sql`ARRAY[${sql.join(
        opts.sourceTypes.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`})`
    : sql``;

  const rows = await db.execute<{
    source_type: string;
    source_id: string;
    chunk: string;
    metadata: Record<string, unknown>;
    similarity: number;
  }>(sql`
    SELECT source_type, source_id, chunk, metadata,
           1 - (embedding <=> ${lit}::vector) AS similarity
    FROM knowledge_embeddings
    WHERE user_id = ${userId} ${typeFilter}
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${k}
  `);

  return (
    rows as unknown as Array<{
      source_type: string;
      source_id: string;
      chunk: string;
      metadata: Record<string, unknown>;
      similarity: number;
    }>
  )
    .map((r) => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      chunk: r.chunk,
      similarity: Number(r.similarity),
      metadata: r.metadata ?? {},
    }))
    .filter((h) => h.similarity >= minSim);
}

/**
 * Retrieve cross-project context for a dispatch and format it as an injectable
 * block. Excludes the project the task is FOR (its own profile is already
 * injected) — this is the captain's unique value: surfacing what other projects
 * learned. Returns "" when RAG is off or nothing's relevant (safe to concat).
 */
export async function retrieveFleetContextBlock(
  userId: string,
  query: string,
  opts?: { excludeProject?: string; k?: number },
): Promise<string> {
  if (!embeddingsEnabled() || !query.trim()) return "";
  const k = opts?.k ?? 4;
  const ex = opts?.excludeProject?.toLowerCase();
  // Coding dispatches may reuse project work, not personal goals, contacts,
  // commitments or thoughts from the same account's broader memory.
  const sourceTypes: KnowledgeSourceType[] = [
    "project_profile",
    "dev_log",
    "orchestration_outcome",
    "repo_doc",
  ];
  const hits = await searchKnowledge(userId, query, { k: k + 3, sourceTypes }).catch(() => []);
  const filtered = hits
    .filter((h) => {
      if (!sourceTypes.includes(h.sourceType as KnowledgeSourceType)) return false;
      const proj = ((h.metadata?.project as string | undefined) ?? h.sourceId).toLowerCase();
      return !ex || (proj !== ex && !proj.startsWith(`${ex}:`));
    })
    .slice(0, k);
  if (filtered.length === 0) return "";
  const lines = filtered.map(
    (h) =>
      `- [${(h.metadata?.project as string) ?? h.sourceId}] ${h.chunk.replace(/\s+/g, " ").slice(0, 280)}`,
  );
  return [
    "## Relevant context from your other projects (retrieved)",
    "Patterns/decisions from across the fleet that may inform this task — reuse where they fit, ignore if not.",
    ...lines,
  ].join("\n");
}
