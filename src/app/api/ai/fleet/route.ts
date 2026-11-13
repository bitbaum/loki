import { readUsageDay } from "@bitbaum/ai-kit";
import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getUserById } from "@/db/queries/users";
import { FLEET_VENDORS, fleetUsageView } from "@/lib/ai/fleet-usage";
import { fleetUsageDir } from "@/lib/ai/usage-dir";

export const dynamic = "force-dynamic";

/**
 * Every app on this server and every AI vendor, today — the operator's view.
 *
 * Reads the one usage log every app writes (ai-kit `usage-log`, AI_USAGE_DIR)
 * and which vendor keys this server holds, by NAME only. Anyone but the
 * operator learns nothing: which apps share a server is not theirs to know.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const user = await getUserById(userId);
  if (!user?.isDefault) return jsonError("Only the operator sees the whole server.", 403);

  const now = Date.now();
  const dir = fleetUsageDir();
  const events = dir ? readUsageDay(dir, new Date(now).toISOString().slice(0, 10)) : null;
  const keysSet = new Set(
    FLEET_VENDORS.map((v) => v.keyEnv).filter((name) => Boolean(process.env[name]?.trim())),
  );

  return jsonOk({ ...fleetUsageView({ events, keysSet, now }), logConfigured: Boolean(dir) });
}
