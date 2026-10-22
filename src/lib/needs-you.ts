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

export type NeedsYouProject = {
  id: string;
  name: string;
  reason: string;
  href: string | null;
  /** The whole sentence when `reason` was shortened to fit one line. */
  fullReason?: string;
  /** A security hole or a site that is down: act before anything else. */
  urgent?: boolean;
};

/**
 * Where an item sits on the page, and whether it is need at all.
 *
 *   urgent  something is broken or exposed; shown in full, first, with a
 *           one-tap hand-off to Loki
 *   decide  waiting on a yes, a no or a read: approvals, feedback, flags
 *   tidy    housekeeping (a site without the feedback widget). Real, but
 *           not need: it sits on one quiet line and is NOT in the count.
 *
 * Measured 2026-10-04: the front door said "17 things need you" for one
 * security hole, seven approvals, eight reports and a missing widget, all
 * in one list at one weight. A number that large with no order in it reads
 * as noise, and the hole that actually mattered was line one of seventeen.
 */
export type NeedsYouTier = "urgent" | "decide" | "tidy";

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
  /** An alert row can be dismissed where it is read. */
  dismissAlertId?: string;
  /** How many things this one line stands for (an "N people" row is N). */
  weight: number;
  tier: NeedsYouTier;
};

/**
 * The front door's list, in the order a person should act on it: what is
 * broken first, then what is waiting on a yes, then the small queue.
 *
 * The total is the SUM OF THE WEIGHTS of the urgent and decide rows — there is
 * no second count to drift. Tidy rows and system alerts are outside it: the
 * builder's alarms are linked from one line to /system, and counting them here
 * is how Today grew eight cards of repo paths and model ids.
 */
export function composeNeedsYou(input: NeedsYouInputs): {
  items: NeedsYouItem[];
  total: number;
  urgent: number;
} {
  const items: NeedsYouItem[] = [];

  for (const alert of input.alerts.filter((a) => a.urgent)) {
    items.push(alertItem(alert));
  }

  // Urgent projects first, still after urgent alerts.
  const projects = [...input.projects].sort((x, y) => Number(!!y.urgent) - Number(!!x.urgent));
  for (const p of projects) {
    items.push({
      key: `project:${p.id}`,
      label: p.name,
      reason: p.reason,
      href: p.href,
      detail: p.fullReason && p.fullReason !== p.reason ? [p.fullReason] : undefined,
      urgent: p.urgent,
      weight: 1,
      tier: p.urgent ? "urgent" : "decide",
    });
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
        tier: "decide",
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
          tier: "decide",
        });
      }
      for (const o of a.others) {
        items.push({
          key: `approval:${o.id}`,
          label: o.title,
          reason: "Waiting for your approval",
          href: "/approvals",
          weight: 1,
          tier: "decide",
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
      tier: "decide",
    });
  }

  if (input.widgetCount > 0) {
    const n = input.widgetCount;
    items.push({
      key: "widget",
      label: `${n} ${n === 1 ? "site is" : "sites are"} missing the feedback widget`,
      href: "/feedback",
      weight: n,
      tier: "tidy",
    });
  }

  for (const alert of input.alerts.filter((x) => !x.urgent)) {
    items.push(alertItem(alert));
  }

  const counted = items.filter((i) => i.tier !== "tidy");
  return {
    items,
    total: counted.reduce((sum, i) => sum + i.weight, 0),
    urgent: counted.filter((i) => i.tier === "urgent").reduce((sum, i) => sum + i.weight, 0),
  };
}

/**
 * The verdict's one line. With something urgent it leads with that, because
 * "1 urgent" is a different morning from "17 things"; then what the rest is.
 * Housekeeping never makes the sentence.
 */
export function needsYouHeadline(items: readonly NeedsYouItem[]): string {
  // One sentence that says what the number is made of (design reset,
  // 2026-10-22). "4 urgent · 53 waiting on you" sat under a bell reading 3,
  // and nothing on the screen said the 53 were 42 reports and 7 approvals.
  const counted = items.filter((i) => i.tier !== "tidy");
  const sum = (pick: (i: NeedsYouItem) => boolean) =>
    counted.filter(pick).reduce((n, i) => n + i.weight, 0);
  const urgent = sum((i) => i.tier === "urgent");
  const approvals = sum((i) => i.tier !== "urgent" && i.key.startsWith("approval"));
  const reports = sum((i) => i.tier !== "urgent" && i.key === "feedback");
  const other = sum(
    (i) => i.tier !== "urgent" && !i.key.startsWith("approval") && i.key !== "feedback",
  );
  const parts = [
    urgent > 0 && `${urgent} urgent`,
    approvals > 0 && `${approvals} ${approvals === 1 ? "approval" : "approvals"}`,
    reports > 0 && `${reports} ${reports === 1 ? "report" : "reports"} to triage`,
    other > 0 && `${other} other ${other === 1 ? "thing" : "things"}`,
  ].filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return "Nothing needs you.";
  const text =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${text}.`;
}

function alertItem(alert: NeedsYouAlert): NeedsYouItem {
  return {
    key: `alert:${alert.id}`,
    label: alert.title,
    href: alert.href,
    // The first paragraph says what is wrong; the rest is the technical
    // record (producers write it that way) and stays on /system and the bell.
    detail: alert.description ? [alert.description.split(/\n\s*\n/)[0]!.trim()] : undefined,
    urgent: alert.urgent,
    dismissAlertId: alert.id,
    weight: 1,
    tier: alert.urgent ? "urgent" : "decide",
  };
}
