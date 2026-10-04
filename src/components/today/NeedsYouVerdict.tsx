"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle, Check, ChevronRight, Loader2, Server } from "lucide-react";
import { useControlInbox } from "@/hooks/use-control-inbox";
import { DismissAlertButton } from "./DismissAlertButton";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import {
  composeNeedsYou,
  needsYouHeadline,
  type NeedsYouAlert,
  type NeedsYouApprovals,
  type NeedsYouItem,
  type NeedsYouProject,
} from "@/lib/needs-you";

export type FlaggedProject = NeedsYouProject;

/**
 * The answer, at the front door — and the ONLY place "N things need you" is said.
 *
 * /today used to say it here and then say it again, differently, in an Action
 * Queue card (six people, each with their WhatsApp and phone number, and a
 * full drafted email) and an Alerts card (repository paths, model ids, "re-run
 * `npm run check:models`"). Measured 2026-10-01: ~900 words before the reader
 * learned what to do first, and four surfaces giving four different counts.
 *
 * Now there is one list, composed by lib/needs-you, one line per item, in the
 * order to act on it. A line with more behind it opens in place; everything
 * else is a link to the page that acts on it. The builder's alarms are one
 * line at the end, pointing at /system, where they are listed in full.
 *
 * A FAILED FETCH IS NOT "NOTHING". `loadFailed` renders as "couldn't check",
 * never as a calm all-clear.
 *
 * Three tiers (lib/needs-you): URGENT items are shown in full with a one-tap
 * hand-off to Loki, because "Email verification bypass: anyone can register…"
 * cut at ninety characters is the one sentence on this page that must be read
 * whole. DECIDE items are one line each. TIDY items and the builder's alarms
 * share one quiet "Also" line and are not counted.
 */
export function NeedsYouVerdict({
  flagged,
  approvals,
  alerts,
  systemAlertCount,
}: {
  flagged: FlaggedProject[];
  approvals: NeedsYouApprovals;
  alerts: NeedsYouAlert[];
  systemAlertCount: number;
}) {
  const inbox = useControlInbox();

  if (inbox.settling) {
    return (
      <section className="ui-verdict" aria-label="What needs you">
        <p className="ui-verdict-line text-text-muted">
          <Loader2 className="ui-spinner-xs" aria-hidden /> Checking what needs you…
        </p>
      </section>
    );
  }

  const { items, total, urgent } = composeNeedsYou({
    projects: flagged,
    approvals,
    feedbackCount: inbox.feedbackCount,
    widgetCount: inbox.needsWidget.length,
    alerts,
    systemAlertCount,
  });

  const tidy = items.filter((i) => i.tier === "tidy");
  const systemLine =
    systemAlertCount > 0 || tidy.length > 0 ? (
      <p className="ui-verdict-also">
        <Server className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Also: </span>
        {tidy.map((t) =>
          t.href ? (
            <Link key={t.key} href={t.href} className="ui-verdict-also-link">
              {t.label}
            </Link>
          ) : (
            <span key={t.key}>{t.label}</span>
          ),
        )}
        {systemAlertCount > 0 && (
          <Link href="/system#system-alerts" className="ui-verdict-also-link">
            {systemAlertCount} system {systemAlertCount === 1 ? "alert" : "alerts"}
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Link>
        )}
      </p>
    ) : null;

  if (inbox.loadFailed) {
    return (
      <section className="ui-verdict ui-verdict-unknown" aria-label="What needs you">
        <p className="ui-verdict-line">Could not check everything that needs you.</p>
        <p className="ui-verdict-sub">
          The feedback queue failed to load, so this is not an all-clear.{" "}
          <button type="button" onClick={inbox.refetch} className="underline underline-offset-2">
            Try again
          </button>
        </p>
        {items.length > 0 && <NeedsYouList items={items.filter((i) => i.tier !== "tidy")} />}
        {systemLine}
      </section>
    );
  }

  if (total === 0) {
    /* An empty queue is the best possible state, so it gets said plainly
       rather than rendered as an absence. */
    return (
      <section className="ui-verdict" aria-label="What needs you">
        <p className="ui-verdict-line">
          <Check className="h-4 w-4 shrink-0 text-status-positive" aria-hidden /> Nothing needs you.
        </p>
        {systemLine}
      </section>
    );
  }

  const urgentItems = items.filter((i) => i.tier === "urgent");
  return (
    <section className="ui-verdict ui-verdict-alert" aria-label="What needs you">
      <p className="ui-verdict-line">
        <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning" aria-hidden />
        {needsYouHeadline(total, urgent)}
      </p>
      {urgentItems.length > 0 && (
        <ul className="ui-verdict-list">
          {urgentItems.map((item) => (
            <li key={item.key}>
              <UrgentRow item={item} />
            </li>
          ))}
        </ul>
      )}
      <NeedsYouList items={items.filter((i) => i.tier === "decide")} />
      {systemLine}
    </section>
  );
}

/**
 * An urgent item, whole: what is wrong in its own words, where to look, and
 * Loki one tap away. "Fix with Loki" opens Loki with the problem written out;
 * it starts nothing until the operator sends it.
 */
function UrgentRow({ item }: { item: NeedsYouItem }) {
  const text = item.detail?.[0] ?? item.reason ?? "";
  return (
    <div className="ui-verdict-urgent">
      <p className="ui-verdict-urgent-head">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-status-negative" aria-hidden />
        <span className="ui-verdict-label">{item.label}</span>
      </p>
      {text && <p className="ui-verdict-urgent-text">{text}</p>}
      <div className="ui-verdict-actions">
        <LokiDispatchButton
          prompt={`Urgent in ${item.label}: ${text}\n\nInvestigate it, confirm the impact, and propose the smallest safe fix.`}
          label="Fix with Loki"
          title={`Ask Loki to fix this in ${item.label}`}
          className="ui-btn-pill-positive"
        />
        {item.href && (
          <Link href={item.href} className="ui-verdict-open">
            Open <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
        {item.dismissAlertId && <DismissAlertButton alertId={item.dismissAlertId} />}
      </div>
    </div>
  );
}

function NeedsYouList({ items }: { items: NeedsYouItem[] }) {
  return (
    <ul className="ui-verdict-list">
      {items.map((item) => (
        <li key={item.key}>
          <NeedsYouRow item={item} />
        </li>
      ))}
    </ul>
  );
}

function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  const head = (
    <>
      {item.urgent && (
        <AlertCircle
          className="h-3.5 w-3.5 shrink-0 self-center text-status-negative"
          aria-hidden
        />
      )}
      <span className="ui-verdict-label">{item.label}</span>
      {item.reason && <span className="ui-verdict-reason">{item.reason}</span>}
    </>
  );

  // More behind it: open in place, and the page that acts on it is one tap
  // further — never a dead end, never a wall of detail by default.
  const detail = item.detail ?? [];
  if (detail.length > 0 || item.dismissAlertId) {
    return (
      <details className="ui-verdict-expand">
        <summary className="ui-verdict-item">
          {head}
          <ChevronRight className="ui-verdict-chevron" aria-hidden />
        </summary>
        <div className="ui-verdict-detail">
          {detail.length > 1 ? (
            <ul className="space-y-1">
              {detail.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : detail.length === 1 ? (
            <p>{detail[0]}</p>
          ) : null}
          <div className="flex items-center gap-3">
            {item.href && (
              <Link href={item.href} className="ui-verdict-open">
                Open <ChevronRight className="h-3 w-3" aria-hidden />
              </Link>
            )}
            {item.dismissAlertId && <DismissAlertButton alertId={item.dismissAlertId} />}
          </div>
        </div>
      </details>
    );
  }

  return item.href ? (
    <Link href={item.href} className="ui-verdict-item">
      {head}
    </Link>
  ) : (
    <span className="ui-verdict-item">{head}</span>
  );
}
