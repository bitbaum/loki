import { getPendingActions } from "@/db/queries/actions";
import { getActiveAlerts } from "@/db/queries/alerts";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { isSystemAlertType } from "@/config/alert-types";
import { CHECKIN_TITLE_PREFIX } from "@/lib/actions/checkin-proposal";
import { ALERT_SEVERITY } from "@/lib/constants/statuses";
import type { NeedsYouAlert, NeedsYouApprovals } from "@/lib/needs-you";

/**
 * The server half of the front door: approvals and alerts, read once.
 *
 * Privacy follows the cards this replaced. A proposed action or an operator
 * alert can name a contact, so behind the PIN only COUNTS leave the server —
 * the same thing /approvals already shows on its lock screen. System alerts
 * name repositories and machines, never people, so their count is always safe.
 */
export async function loadNeedsYouExtras(userId: string): Promise<{
  approvals: NeedsYouApprovals;
  alerts: NeedsYouAlert[];
  systemAlertCount: number;
}> {
  const [locked, pending, active] = await Promise.all([
    isPrivateZoneLocked(userId),
    getPendingActions(userId).catch(() => []),
    getActiveAlerts(userId).catch(() => []),
  ]);

  const systemAlertCount = active.filter((a) => isSystemAlertType(a.type)).length;
  const operator = active.filter((a) => !isSystemAlertType(a.type));

  const checkins = pending.filter((a) => a.title.startsWith(CHECKIN_TITLE_PREFIX));
  const others = pending.filter((a) => !a.title.startsWith(CHECKIN_TITLE_PREFIX));

  return {
    approvals: {
      count: pending.length,
      locked,
      checkinNames: locked ? [] : checkins.map((a) => a.title.replace(CHECKIN_TITLE_PREFIX, "")),
      others: locked ? [] : others.map((a) => ({ id: a.id, title: a.title })),
    },
    // Locked: operator alerts may carry contact names, so they wait for the PIN
    // like the card that used to show them did.
    alerts: locked
      ? []
      : operator.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          href: a.actionUrl,
          urgent: a.severity === ALERT_SEVERITY.URGENT,
        })),
    systemAlertCount,
  };
}
