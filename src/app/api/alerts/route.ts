import { getApiUserId } from "@/lib/session";
import { getActiveAlerts } from "@/db/queries/alerts";
import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { isAlertCurrent } from "@/lib/alerts/relevance";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const now = Date.now();
  // `earlier`: past its relevance (lib/alerts/relevance) — listed under
  // "Earlier" in the bell, and not counted.
  const alerts = (await getActiveAlerts(userId)).map((a) => ({
    ...a,
    earlier: !isAlertCurrent(a, now),
  }));
  return jsonOk({ alerts });
}
