/**
 * A short-lived agent token for a check that runs ON the box as the operator.
 *
 * The box-side checks (scripts/hetzner/loki-e2e-check.sh) used to sign in by
 * minting an Auth.js session cookie from AUTH_SECRET. Loki signs in through
 * AccountKit since 2026-11-01 (docs/architecture/accountkit-migration.md):
 * a session is a database row now, the minted cookie is no session at all,
 * and from that day the check answered "could not mint a session" and asked
 * Loki nothing. Found 2026-11-12, when the check was first run on demand.
 *
 * Every API route the check calls accepts a ck_ agent token (lib/session
 * getApiUserId), which is how a runner signs in. So the check mints one for
 * the operator, uses it and removes it:
 *
 *   DATABASE_URL=… tsx scripts/test/mint-check-token.ts            prints ck_…
 *   DATABASE_URL=… tsx scripts/test/mint-check-token.ts --revoke   removes them
 *
 * The token expires by itself after two hours, so one that a killed check
 * never revoked is not a standing credential. Nothing is printed but the
 * token (stdout) or a reason (stderr); the caller must not log stdout.
 */
import { randomBytes } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env.hetzner.local", quiet: true });

/** The label that marks a token as this check's, and nobody else's. */
export const CHECK_TOKEN_LABEL = "loki-e2e-check";
const LIFETIME_MINUTES = 120;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  const revoke = process.argv.includes("--revoke");
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    if (revoke) {
      await sql`DELETE FROM agent_tokens WHERE label = ${CHECK_TOKEN_LABEL}`;
      return;
    }
    // The operator: the same account scripts/test/print-session-token.ts took.
    const rows = await sql`
      SELECT id FROM users
      WHERE is_default = true OR email IS NOT NULL
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    const userId = (rows[0] as { id?: string } | undefined)?.id;
    if (!userId) throw new Error("no operator account found");
    // One at a time: a token an earlier, killed check left behind goes first.
    await sql`DELETE FROM agent_tokens WHERE label = ${CHECK_TOKEN_LABEL}`;
    const token = `ck_${randomBytes(32).toString("hex")}`;
    await sql`
      INSERT INTO agent_tokens (token, label, user_id, expires_at)
      VALUES (${token}, ${CHECK_TOKEN_LABEL}, ${userId},
              NOW() + (${LIFETIME_MINUTES} * INTERVAL '1 minute'))
    `;
    process.stdout.write(token);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
