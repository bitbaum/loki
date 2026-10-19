"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { patchJson } from "@/lib/api/fetch";
import { timeAgo } from "@/lib/dates";
import { alertActionLabel } from "@/config/alert-types";
import { cn } from "@/lib/utils";

/** What a row needs of an alert — the DB row on /system, its JSON in the bell. */
export type AlertListItem = {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  actionUrl: string | null;
  createdAt: Date | string;
};

/**
 * Alerts as a calm list — the bell's panel and /system both draw this.
 *
 * They were two different shapes of the same mistake: the bell put a
 * "WARNING"/"INFO" label in capitals beside every title, the whole description,
 * a bordered "View" and a bare tick nobody read as "dismiss"; /system put each
 * alert in a beige or red box holding its full text — "a bunch of text … some
 * are red, some are green. Very bad design" (owner, 2026-10-19).
 *
 * Now each row is one thing to read and one thing to do: a dot only when it
 * is urgent or a warning, the title, the description's first paragraph in at
 * most two lines (the rest — what an engineer needs — behind "Details"), when,
 * and ONE button that says where it goes (`action` in config/alert-types). The
 * whole row opens it. "Dismiss" is a word, not a tick.
 */
export function AlertList({
  alerts,
  onNavigate,
  onDismissed,
}: {
  alerts: AlertListItem[];
  /** Called as a row's action is followed (the bell closes its panel). */
  onNavigate?: () => void;
  /** Called after a dismissal lands (refetch, or refresh the page). */
  onDismissed?: (id: string) => void;
}) {
  return (
    <ul className="ui-alert-list">
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} onNavigate={onNavigate} onDismissed={onDismissed} />
      ))}
    </ul>
  );
}

function AlertRow({
  alert,
  onNavigate,
  onDismissed,
}: {
  alert: AlertListItem;
  onNavigate?: () => void;
  onDismissed?: (id: string) => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { summary, details } = splitDescription(alert.description);
  // A button to the page you are on is a button that does nothing.
  const href = alert.actionUrl && alert.actionUrl !== pathname ? alert.actionUrl : null;
  const dot =
    alert.severity === "urgent"
      ? "ui-alert-dot-urgent"
      : alert.severity === "warning"
        ? "ui-alert-dot-warning"
        : null;

  const dismiss = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await patchJson(`/api/alerts/${alert.id}/dismiss`, {});
      if (!res.ok) throw new Error(String(res.status));
      onDismissed?.(alert.id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="ui-alert-row">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={dot ?? "ui-alert-dot-none"} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} onClick={onNavigate} className="ui-alert-title ui-alert-row-link">
              {alert.title}
            </Link>
          ) : (
            <p className="ui-alert-title">{alert.title}</p>
          )}
          {summary && <p className={cn("ui-alert-summary", !open && "line-clamp-2")}>{summary}</p>}
          {open && details && <p className="ui-alert-details">{details}</p>}
          <div className="ui-alert-foot">
            <span>{timeAgo(new Date(alert.createdAt).getTime())}</span>
            {(details || summary.length > 140) && (
              <button
                type="button"
                className="ui-alert-quiet"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
              >
                {open ? "Less" : "Details"}
              </button>
            )}
            <button
              type="button"
              className="ui-alert-quiet"
              onClick={() => void dismiss()}
              disabled={busy}
            >
              {busy ? "Dismissing…" : failed ? "Try again" : "Dismiss"}
            </button>
            {href && (
              <Link
                href={href}
                onClick={onNavigate}
                className="ui-alert-action"
                tabIndex={-1}
                aria-hidden="true"
              >
                {alertActionLabel(alert.type, href)}
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The first paragraph says what is wrong and what to do; anything after the
 * first blank line is the technical record (producers write it that way).
 */
export function splitDescription(text: string | null): { summary: string; details: string } {
  const body = (text ?? "").trim();
  const cut = body.search(/\n\s*\n/);
  if (cut === -1) return { summary: body, details: "" };
  return { summary: body.slice(0, cut).trim(), details: body.slice(cut).trim() };
}
