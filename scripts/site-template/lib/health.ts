import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";

/**
 * What /api/health asserts. Booleans and states only — never a key, a hint of
 * a key, a host or a connection string.
 *
 * "db up" means more than "the server answered": the app's own role can READ
 * its own users table. A migration once created a table the app could not
 * read (vitareba), and `SELECT 1` was green throughout.
 */
export type DbState = "up" | "down" | "unconfigured";

export interface Health {
  ok: boolean;
  commit: string | null;
  db: DbState;
  accounts: boolean;
  mail: boolean;
  ai: boolean;
}

export async function probeDatabase(timeoutMs = 2_000): Promise<DbState> {
  if (!isDatabaseConfigured()) return "unconfigured";
  try {
    const query = getDb().execute(sql`select 1 from users limit 1`);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeoutMs),
    );
    await Promise.race([query, timeout]);
    return "up";
  } catch {
    return "down";
  }
}

export function summarise(input: Omit<Health, "ok">): Health {
  return { ok: input.db === "up" && input.accounts, ...input };
}

/** The commit next.config.ts stamped into this build, or null when unknown. */
export function buildCommit(value: string | undefined = process.env.BUILD_COMMIT): string | null {
  return value && /^[0-9a-f]{40}$/.test(value) ? value : null;
}
