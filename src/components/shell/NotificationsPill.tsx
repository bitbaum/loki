"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_QUERY } from "@/hooks/use-is-narrow";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { splitBell } from "@/lib/alerts/relevance";
import { NotificationPanel } from "./NotificationPanel";
import type { Alert } from "@/db/schema/alerts";

/**
 * Quiet status pill in the app top bar. Three resting states:
 *  - subscribed  → ringing-bell, accent dot. Click to unsubscribe.
 *  - granted/default/denied → muted bell. Click to subscribe (or open OS settings).
 *  - unsupported / not configured → hidden entirely.
 */
/** "Am I past the server render?" — expressed the way BrandVersion already
 *  does it, because `useEffect(() => setMounted(true))` is banned here by
 *  react-hooks/set-state-in-effect. The server snapshot is false, the client
 *  snapshot true, and nothing ever notifies. */
const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function NotificationsPill() {
  const [panelOpen, setPanelOpen] = useState(false);
  const { data, refetch } = useFetch<{ alerts: (Alert & { earlier?: boolean })[] }>("/api/alerts");
  const phone = useMediaQuery(NARROW_QUERY);
  const sheetTitleId = useId();

  /**
   * Render NOTHING until mounted, so the server and the first client render
   * always agree — whatever the environment says.
   *
   * This was the source of a React #418 on EVERY authenticated page in
   * production, and of nothing at all locally. `publicKeyMissing` comes from
   * `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and that value has two
   * different origins: the SERVER reads it at RUNTIME, while the CLIENT gets
   * whatever was INLINED at BUILD time. On the box those disagree — the
   * deploy workflow's build step passes no NEXT_PUBLIC_* env at all, so the
   * client bundle has none of them, while the running server has all of them.
   *
   * Measured on prod: the server-rendered HTML contained this button; the
   * hydrated DOM contained zero; and the key appears in 0 of 17 client chunks
   * (1.1MB scanned). Server said "configured, show it", client said "not
   * configured, hide it", and React threw away the tree.
   *
   * A `mounted` gate makes the first render unconditional, which is the same
   * shape ThemeToggle already uses for the same reason. It is defence, not the
   * whole cure: while the key is missing from the bundle, push genuinely
   * cannot work — see scripts/test/public-env-inlined.ts for that half.
   */
  const mounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  if (!mounted) return null;

  // Things that HAPPENED (a run failed, a deploy finished). The feedback
  // queue is not one of them: it is work waiting, and Home's "To review"
  // already counts it — the bell added it again and read "9+" beside a
  // "Feedback to triage 13" row on the same screen (owner, 2026-10-19).
  // It counts only what is still news (lib/alerts/relevance): a red "9+"
  // over nudges 8, 19 and 28 days old was a number no action could lower
  // (owner, 2026-10-21). Older ones are listed under "Earlier", uncounted.
  const totalCount = splitBell(data?.alerts ?? []).current.length;
  const close = () => {
    setPanelOpen(false);
    // A dismissal inside the panel lowers the count when it closes.
    refetch();
  };
  const hasAlerts = totalCount > 0;

  // Icon-only — the bell state communicates whether there are notifications.
  // Hover-tooltip carries the state explanation. Primary action is opening
  // the notification panel; push subscription is a secondary concern.
  return (
    <>
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        className={cn("ui-topbar-btn relative", hasAlerts && "text-text-primary")}
        title={
          hasAlerts ? `${totalCount} notification${totalCount === 1 ? "" : "s"}` : "Notifications"
        }
        aria-label={hasAlerts ? `${totalCount} notifications` : "Notifications"}
      >
        <Bell className="h-5 w-5" />
        {hasAlerts && (
          <span className="ui-notification-badge">{totalCount > 9 ? "9+" : totalCount}</span>
        )}
      </button>

      {panelOpen &&
        (phone ? (
          // A bottom sheet on a phone, to <body> so the top bar hiding while
          // a dialog is open cannot take it with it.
          createPortal(
            <Modal
              onClose={close}
              position="bottom-mobile"
              size="md"
              padded={false}
              labelledBy={sheetTitleId}
              className="ui-notification-modal"
            >
              <NotificationPanel onClose={close} titleId={sheetTitleId} />
            </Modal>,
            document.body,
          )
        ) : (
          <>
            <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
            <div className="ui-notification-panel">
              <NotificationPanel onClose={close} />
            </div>
          </>
        ))}
    </>
  );
}
