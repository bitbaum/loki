/**
 * Prints the access cookie that opens the operator's previews, for automation
 * on the box (preview-check-on-box.sh): `loki_preview=<value>`. The same
 * operator print-session-token.ts signs in as; the code is theirs from
 * user_preferences, else LOKI_PREVIEW_CODE from the env. Nothing but the
 * cookie value is printed, and the caller never prints that either.
 */
import { config } from "dotenv";
import { createPreviewAccessCookie, previewCodeFor } from "@/lib/previews/access";
import { PREVIEWS } from "@/config/previews";

config({ path: ".env.local", quiet: true });
config({ path: ".env.hetzner.local", quiet: true });

async function main() {
  const hetznerPassword = process.env.LOKI_DB_PASSWORD;
  const hetznerHost = process.env.HETZNER_IP;
  const dbUrl =
    hetznerPassword && hetznerHost
      ? `postgres://loki:${encodeURIComponent(hetznerPassword)}@${hetznerHost}:5432/loki?sslmode=require`
      : process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("No database — set DATABASE_URL or LOKI_DB_PASSWORD + HETZNER_IP");
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  let own: string | null = null;
  try {
    const rows = await sql`
      SELECT p.preview_code AS code
      FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.is_default = true OR u.email IS NOT NULL
      ORDER BY u.is_default DESC, u.created_at ASC
      LIMIT 1
    `;
    own = ((rows[0] as { code: string | null } | undefined)?.code ?? "").trim() || null;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
  const code = previewCodeFor(own);
  if (!code) throw new Error("No preview code is set — previews are closed");
  const cookie = createPreviewAccessCookie(Date.now(), code);
  if (!cookie) throw new Error("No AUTH_SECRET to sign the cookie with");
  process.stdout.write(`${PREVIEWS.cookie}=${cookie}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
