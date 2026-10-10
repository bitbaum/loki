import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getActionByTitle } from "@/db/queries/actions";
import { getBeaconSettings } from "@/db/queries/beacon-settings";
import { nightActionTitle, upcomingNight } from "@/config/autopilot-night";

/**
 * Tonight, for the card on Control: the plan the evening made (if any), where
 * its decision stands, and the allowance the owner set. Reads only; the
 * decision itself is the approval queue's (ActionButtons → /app/actions).
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const night = upcomingNight(new Date());
  const [row, settings] = await Promise.all([
    getActionByTitle(userId, nightActionTitle(night)),
    getBeaconSettings(userId),
  ]);
  return jsonOk({
    night,
    plan: row
      ? {
          actionId: row.id,
          status: row.status,
          body: String(row.payload?.body ?? row.description ?? ""),
          reason: row.reasoning,
          allowed: row.payload?.allowed === true,
        }
      : null,
    allowance: {
      until: settings.night_allow_until,
      capUsd: settings.night_cost_cap_usd,
    },
  });
}
