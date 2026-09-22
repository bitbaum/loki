"use client";

import { useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { cn } from "@/lib/utils";
import { feedbackAwaitingTriage } from "@/lib/feedback/queue-counts";
import type { ProjectFeedbackSummary } from "@/db/queries/site-feedback";
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
  const { data } = useFetch<{ alerts: Alert[] }>("/api/alerts");
  const feedback = useFetch<{ summary: ProjectFeedbackSummary[] }>("/api/feedback/summary");

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

  const alerts = data?.alerts ?? [];
  const feedbackSummary = feedback.data?.summary ?? [];
  const feedbackCount = feedbackAwaitingTriage(feedbackSummary);
  const totalCount = alerts.length + feedbackCount;
  const hasAlerts = totalCount > 0;

  // Icon-only — the bell state communicates whether there are notifications.
  // Hover-tooltip carries the state explanation. Primary action is opening
  // the notification panel; push subscription is a secondary concern.
  return (
    <>
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        className={cn("ui-topbar-btn relative", hasAlerts && "text-accent-text")}
        title={
          hasAlerts ? `${totalCount} notification${totalCount === 1 ? "" : "s"}` : "Notifications"
        }
        aria-label={hasAlerts ? `${totalCount} notifications` : "Notifications"}
      >
        <Bell className="h-4 w-4" />
        {hasAlerts && (
          <span className="ui-notification-badge">{totalCount > 9 ? "9+" : totalCount}</span>
        )}
      </button>

      {panelOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPanelOpen(false)}
            aria-hidden="true"
          />
          <NotificationPanel onClose={() => setPanelOpen(false)} />
        </>
      )}
    </>
  );
}
