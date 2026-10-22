import { Bell } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { getActiveAlerts } from "@/db/queries/alerts";
import { requirePageUserId } from "@/lib/session";
import { ALERT_SEVERITY } from "@/lib/constants/statuses";
import { isSystemAlertType } from "@/config/alert-types";
import { SystemAlertList } from "./SystemAlertList";

/**
 * The builder's alarms — telemetry, runners, repositories, model ids — on
 * /system. /today used to render every alert here at full length; it now lists
 * the operator's alerts as one-line rows and links these in a single line,
 * because a front door that opens on `npm run check:models` is not one.
 * Which alert is which is the registry's `audience` (config/alert-types).
 *
 * The list is the same rows as the bell's (components/alerts/AlertList): it
 * was a stack of beige and red boxes each holding its full text, and the
 * count beside the title shouted "3 urgent" in red (owner, 2026-10-19).
 */
export async function SystemAlertsCard() {
  const userId = await requirePageUserId();
  const items = (await getActiveAlerts(userId)).filter((a) => isSystemAlertType(a.type));
  const urgent = items.filter((a) => a.severity === ALERT_SEVERITY.URGENT).length;
  const count =
    items.length === 0
      ? "All clear"
      : urgent > 0
        ? `${items.length} open · ${urgent} urgent`
        : `${items.length} open`;

  return (
    <div id="system-alerts">
      <SystemBlock>
        <SystemBlockHeader
          icon={Bell}
          title="Alarms"
          right={<span className="text-xs text-text-tertiary">{count}</span>}
        />
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing is wrong with the machinery.</p>
        ) : (
          <div className="ui-alert-card-list">
            <SystemAlertList alerts={items} />
          </div>
        )}
      </SystemBlock>
    </div>
  );
}
