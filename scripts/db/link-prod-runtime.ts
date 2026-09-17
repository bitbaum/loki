/**
 * Wire prod user_projects rows to local dir paths (Fleet Runner dispatch).
 *
 * Usage:
 *   npx tsx scripts/db/link-prod-runtime.ts            # dry run
 *   npx tsx scripts/db/link-prod-runtime.ts --apply    # execute
 *
 * Env: LOKI_DB_PASSWORD + HETZNER_IP from .env.hetzner.local
 */
import { config } from "dotenv";
import { homedir } from "node:os";
import { join } from "node:path";

config({ path: ".env.hetzner.local" });

const APPLY = process.argv.includes("--apply");

/** Entity display name → absolute dir on the operator machine. */
const RUNTIME_LINKS: Array<{ name: string; dirPath: string; reason: string }> = [
  {
    name: "Bitbaum",
    dirPath: join(process.env.DEV_ROOT ?? join(homedir(), "dev"), "bitbaum"),
    reason: "Entity enriched but missing user_projects dir",
  },
];

async function main() {
  const password = process.env.LOKI_DB_PASSWORD;
  const host = process.env.HETZNER_IP;
  if (!password || !host)
    throw new Error("LOKI_DB_PASSWORD / HETZNER_IP missing from .env.hetzner.local");
  process.env.DATABASE_URL = `postgres://loki:${encodeURIComponent(password)}@${host}:5432/loki?sslmode=require`;

  const { db } = await import("../../src/db");
  const { entities, users, userProjects } = await import("../../src/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const { ENTITY_TYPE } = await import("../../src/lib/constants/statuses");
  const { upsertLocalUserProject } = await import("../../src/db/queries/user-projects");
  const { findProjectEntityByName } = await import("../../src/db/queries/project-merge");

  const projectOwners = await db
    .select({ userId: entities.userId, count: sql<number>`count(*)::int` })
    .from(entities)
    .where(eq(entities.type, ENTITY_TYPE.PROJECT))
    .groupBy(entities.userId);
  const ownerCounts = new Map(projectOwners.map((r) => [r.userId, r.count]));
  const allUsers = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users);
  const ownerUser = allUsers
    .filter((u) => (ownerCounts.get(u.id) ?? 0) > 0)
    .sort((a, b) => (ownerCounts.get(b.id) ?? 0) - (ownerCounts.get(a.id) ?? 0))[0];
  if (!ownerUser) throw new Error("No project owner found");
  const userId = ownerUser.id;

  console.log(
    `${APPLY ? "Applying" : "Dry run"} link-prod-runtime for ${ownerUser.name ?? ownerUser.email}\n`,
  );

  for (const link of RUNTIME_LINKS) {
    const entity = await findProjectEntityByName(userId, link.name);
    if (!entity) {
      console.log(`— skip ${link.name}: entity not found`);
      continue;
    }

    const [existing] = await db
      .select({ dir: userProjects.dirPath, entityId: userProjects.entityProjectId })
      .from(userProjects)
      .where(
        and(
          eq(userProjects.userId, userId),
          sql`lower(${userProjects.name}) = lower(${link.name.trim()})`,
        ),
      );

    if (existing?.dir === link.dirPath && existing.entityId === entity.id) {
      console.log(`— skip ${link.name}: already linked (${link.dirPath})`);
      continue;
    }

    console.log(`${APPLY ? "✚" : "DRY"} ${link.name} → ${link.dirPath} — ${link.reason}`);
    if (APPLY) {
      await upsertLocalUserProject({ userId, name: link.name, dirPath: link.dirPath });
      console.log(`   linked entity ${entity.id.slice(0, 8)}`);
    }
  }

  if (!APPLY) console.log("\nRe-run with --apply to write changes.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
