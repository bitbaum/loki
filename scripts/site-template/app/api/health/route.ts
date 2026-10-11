import { freeAvailable } from "@/lib/ai";
import { authStatus } from "@/lib/auth/server";
import { buildCommit, probeDatabase, summarise } from "@/lib/health";
import { mailConfigured } from "@/lib/mail";

/**
 * GET /api/health — the one thing to curl after a deploy, and what the Live
 * check workflow and the auto-merge reconciler read. 200 only when the
 * database is reachable AND the app can read its own tables; 503 otherwise,
 * with the same body saying which part is missing.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const health = summarise({
    commit: buildCommit(),
    db: await probeDatabase(),
    accounts: authStatus().ready,
    mail: mailConfigured(),
    ai: freeAvailable(process.env),
  });
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
