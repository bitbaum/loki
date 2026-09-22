"use client";

import { useState } from "react";
import Link from "next/link";
import { X, Check, ExternalLink, MessageSquare } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { patchJson, throwApiError } from "@/lib/api/fetch";
import { compactRelativeDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ProjectFeedbackSummary } from "@/db/queries/site-feedback";
import type { Alert } from "@/db/schema/alerts";

const SEVERITY_CONFIG = {
  info: { label: "Info", color: "text-text-secondary" },
  warning: { label: "Warning", color: "text-status-warning" },
  urgent: { label: "Urgent", color: "text-status-negative" },
} as const;

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { data, loading, refetch } = useFetch<{ alerts: Alert[] }>("/api/alerts");
  const feedback = useFetch<{ summary: ProjectFeedbackSummary[] }>("/api/feedback/summary");
  const [busyId, setBusyId] = useState<string | null>(null);

  const alerts = data?.alerts ?? [];
  const feedbackSummary = feedback.data?.summary ?? [];
  const feedbackItems = feedbackSummary.filter((f) => f.newCount > 0 || f.openCount > 0);

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      const res = await patchJson(`/api/alerts/${id}/dismiss`, {});
      if (!res.ok) await throwApiError(res, "Could not dismiss alert");
      refetch();
      feedback.refetch();
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

      {(loading || feedback.loading) && (
        <div className="ui-notification-empty">
          <p>Loading…</p>
        </div>
      )}

      {!loading && !feedback.loading && alerts.length === 0 && feedbackItems.length === 0 && (
        <div className="ui-notification-empty">
          <p>No notifications</p>
        </div>
      )}

      {!loading && !feedback.loading && (alerts.length > 0 || feedbackItems.length > 0) && (
        <ul className="ui-notification-list">
          {feedbackItems.map((item) => (
            <li key={item.projectId} className="ui-notification-item">
              <div className="ui-notification-item-main">
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 shrink-0 text-text-tertiary" />
                  <div className="min-w-0 flex-1">
                    <p className="ui-notification-item-title">{item.projectName} feedback</p>
                    <p className="ui-notification-item-description">
                      {item.newCount > 0
                        ? `${item.newCount} new item${item.newCount === 1 ? "" : "s"} need${item.newCount === 1 ? "s" : ""} triage`
                        : `${item.openCount} dispatched item${item.openCount === 1 ? "" : "s"}`}
                    </p>
                    <p className="ui-notification-item-meta">
                      {compactRelativeDate(new Date(item.latestAt))}
                    </p>
                  </div>
                </div>
              </div>
              <div className="ui-notification-item-actions">
                <Link
                  href={`/feedback?project=${encodeURIComponent(item.projectName)}`}
                  className="ui-btn-secondary ui-btn-sm"
                  onClick={onClose}
                >
                  <ExternalLink className="h-3 w-3" />
                  View
                </Link>
              </div>
            </li>
          ))}

          {alerts
            .filter((a) => a.type !== "new_feedback")
            .map((alert) => (
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
                  <p className="ui-notification-item-meta">
                    {compactRelativeDate(alert.createdAt)}
                  </p>
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
