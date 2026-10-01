/**
 * What needs the operator — ONE composition, read by every surface that says it.
 *
 * Measured on production 2026-10-01: Today said "8 things need you", Control's
 * panel said "Needs you 7", Activity said "4 things need you" and Approvals
 * said "7 proposed actions". Four answers to what reads as one question. They
 * were not all wrong — they counted four different things under one phrase:
 *
 *   Control's panel   feedback awaiting triage + sites missing the widget
 *   Today             that, plus flagged/blocked projects
 *   Activity          runs in the window that failed or wait on input
 *   Approvals         actions Loki proposed and is holding for a yes
 *
 * So the fix is two rules, both enforced by scripts/test/needs-you-one-owner.ts:
 *
 * 1. "N things need you" is said in ONE place — the front door — and its number
 *    is the sum of the parts this module composes, never a count of its own.
 * 2. Every other surface names exactly what IT counts, with the words below,
 *    so a smaller number elsewhere reads as a part, not a contradiction.
 */

export const NEEDS_YOU_LABELS = {
  /** Control's inbox panel: a PART of the front door's list. */
  review: "To review",
  /** Activity's tile: runs only, in the selected window. */
  runs: "Runs need you",
} as const;

/** "4 runs need you" — Activity's headline. Plural rules in one place. */
export function runsNeedYouSentence(n: number): string {
  return n === 1 ? "1 run needs you" : `${n} runs need you`;
}

/** "7 actions waiting for approval" — Approvals and Today agree on the words. */
export function approvalsSentence(n: number): string {
  return n === 1 ? "1 action waiting for approval" : `${n} actions waiting for approval`;
}

export type NeedsYouProject = { id: string; name: string; reason: string; href: string | null };

export type NeedsYouApprovals = {
  count: number;
  /** Behind the PIN: only the count may be shown. */
  locked: boolean;
  /** People Loki proposes you check in with — collapsed into one row. */
  checkinNames: string[];
  /** Every other proposed action, one line each. */
  others: { id: string; title: string }[];
};

export type NeedsYouAlert = {
  id: string;
  title: string;
  description: string | null;
  href: string | null;
  urgent: boolean;
};

export type NeedsYouInputs = {
  projects: NeedsYouProject[];
  approvals: NeedsYouApprovals;
  feedbackCount: number;
  widgetCount: number;
  /** Operator-audience alerts. System alerts are NOT here — see systemAlertCount. */
  alerts: NeedsYouAlert[];
  /** Engineering alarms (telemetry, runners, repos, models). Linked, not listed. */
  systemAlertCount: number;
};

export type NeedsYouItem = {
  key: string;
  /** The one line. */
  label: string;
  /** Second line, already short. Optional. */
  reason?: string;
  href: string | null;
  /** Shown on expand — names, or an alert's full text. */
  detail?: string[];
  urgent?: boolean;
  /** How many things this one line stands for (an "N people" row is N). */
  weight: number;
};

/**
 * The front door's list, in the order a person should act on it: what is
 * broken first, then what is waiting on a yes, then the small queue.
 *
 * The total is the SUM OF THE WEIGHTS — there is no second count to drift.
 * System alerts are deliberately outside it: they are the builder's alarms,
 * linked from one line to /system, and counting them here is how Today grew
 * eight cards of repo paths and model ids.
 */
export function composeNeedsYou(input: NeedsYouInputs): { items: NeedsYouItem[]; total: number } {
  const items: NeedsYouItem[] = [];

  for (const alert of input.alerts.filter((a) => a.urgent)) {
    items.push(alertItem(alert));
  }

  for (const p of input.projects) {
    items.push({ key: `project:${p.id}`, label: p.name, reason: p.reason, href: p.href, weight: 1 });
  }

  const a = input.approvals;
  if (a.count > 0) {
    if (a.locked) {
      items.push({
        key: "approvals:locked",
        label: approvalsSentence(a.count),
        reason: "Behind your PIN",
        href: "/unlock?next=/approvals",
        weight: a.count,
      });
    } else {
      if (a.checkinNames.length > 0) {
        const n = a.checkinNames.length;
        items.push({
          key: "approvals:checkins",
          label: n === 1 ? `Reach out to ${a.checkinNames[0]}` : `Reach out to ${n} people`,
          href: "/approvals",
          detail: n === 1 ? undefined : a.checkinNames,
          weight: n,
        });
      }
      for (const o of a.others) {
        items.push({
          key: `approval:${o.id}`,
          label: o.title,
          reason: "Waiting for your approval",
          href: "/approvals",
          weight: 1,
        });
      }
    }
  }

  if (input.feedbackCount > 0) {
    const n = input.feedbackCount;
    items.push({
      key: "feedback",
      label: `${n} feedback ${n === 1 ? "report" : "reports"} to triage`,
      href: "/feedback",
      weight: n,
    });
  }

  if (input.widgetCount > 0) {
    const n = input.widgetCount;
    items.push({
      key: "widget",
      label: `${n} ${n === 1 ? "site is" : "sites are"} missing the feedback widget`,
      href: "/feedback",
      weight: n,
    });
  }

  for (const alert of input.alerts.filter((x) => !x.urgent)) {
    items.push(alertItem(alert));
  }

  return { items, total: items.reduce((sum, i) => sum + i.weight, 0) };
}

function alertItem(alert: NeedsYouAlert): NeedsYouItem {
  return {
    key: `alert:${alert.id}`,
    label: alert.title,
    href: alert.href,
    detail: alert.description ? [alert.description] : undefined,
    urgent: alert.urgent,
    weight: 1,
  };
}
