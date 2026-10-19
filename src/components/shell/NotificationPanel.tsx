"use client";

import { useState } from "react";
import Link from "next/link";
import { X, Check, ExternalLink } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { patchJson, throwApiError } from "@/lib/api/fetch";
import { compactRelativeDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Alert } from "@/db/schema/alerts";

const SEVERITY_CONFIG = {
  info: { label: "Info", color: "text-text-secondary" },
  warning: { label: "Warning", color: "text-status-warning" },
  urgent: { label: "Urgent", color: "text-status-negative" },
} as const;

/** What the bell shows: things that happened. Feedback waiting for triage is
 *  work, listed under Home's "To review" and on /feedback — not here too. */
export function bellAlerts(alerts: Alert[]): Alert[] {
  return alerts.filter((a) => a.type !== "new_feedback");
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { data, loading, refetch } = useFetch<{ alerts: Alert[] }>("/api/alerts");
  const [busyId, setBusyId] = useState<string | null>(null);

  const alerts = bellAlerts(data?.alerts ?? []);

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      const res = await patchJson(`/api/alerts/${id}/dismiss`, {});
      if (!res.ok) await throwApiError(res, "Could not dismiss alert");
      refetch();
    } catch (_e) {
      // Silent fail — user can retry
    } finally {
      setBusyId(null);
    }
  }

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
          <p>No notifications</p>
        </div>
      )}

      {!loading && alerts.length > 0 && (
        <ul className="ui-notification-list">
          {alerts.map((alert) => (
            <li key={alert.id} className="ui-notification-item">
              <div className="ui-notification-item-main">
                <div className="flex items-start justify-between gap-2">
                  <p className="ui-notification-item-title">{alert.title}</p>
                  <span
                    className={cn(
                      "ui-notification-severity",
                      SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG]?.color ??
                        "text-text-secondary",
                    )}
                  >
                    {SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG]?.label ??
                      alert.severity}
                  </span>
                </div>
                {alert.description && (
                  <p className="ui-notification-item-description">{alert.description}</p>
                )}
                <p className="ui-notification-item-meta">{compactRelativeDate(alert.createdAt)}</p>
              </div>
              <div className="ui-notification-item-actions">
                {alert.actionUrl && (
                  <Link
                    href={alert.actionUrl}
                    className="ui-btn-secondary ui-btn-sm"
                    onClick={onClose}
                  >
                    <ExternalLink className="h-3 w-3" />
                    View
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(alert.id)}
                  disabled={busyId === alert.id}
                  className="ui-btn-icon"
                  title="Dismiss"
                  aria-label="Dismiss notification"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
