"use client";

import { X } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import type { Alert } from "@/db/schema/alerts";
import { AlertList } from "@/components/alerts/AlertList";

/** What the bell shows: things that happened. Feedback waiting for triage is
 *  work, listed under Home's "To review" and on /feedback — not here too. */
export function bellAlerts(alerts: Alert[]): Alert[] {
  return alerts.filter((a) => a.type !== "new_feedback");
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { data, loading, refetch } = useFetch<{ alerts: Alert[] }>("/api/alerts");
  const alerts = bellAlerts(data?.alerts ?? []);

  return (
    <div className="ui-notification-panel">
      <header className="ui-notification-header">
        <h2 className="ui-notification-title">Notifications</h2>
        <button
          type="button"
          onClick={onClose}
          className="ui-btn-icon"
          aria-label="Close notifications"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {loading && (
        <div className="ui-notification-empty">
          <p>Loading…</p>
        </div>
      )}

      {!loading && alerts.length === 0 && (
        <div className="ui-notification-empty">
          <p>Nothing new. Anything that needs you shows up here.</p>
        </div>
      )}

      {!loading && alerts.length > 0 && (
        <div className="ui-notification-list">
          <AlertList alerts={alerts} onNavigate={onClose} onDismissed={() => refetch()} />
        </div>
      )}
    </div>
  );
}
