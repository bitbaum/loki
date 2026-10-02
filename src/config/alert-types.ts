/**
 * Every alert type the fleet can raise — SSOT.
 *
 * WHY THIS EXISTS
 * ---------------
 * An alert type outlives the code that raised it. Measured in production on
 * 2026-08-26: ten alerts were open and **four of them were zombies** —
 * `bill_due`, `stale_relationship`, `overdue_commitment` and `stalled_goal`
 * were raised between 2026-05-10 and 2026-06-23 by features that no longer
 * exist. Nothing could refresh them, nothing could auto-resolve them, and
 * `alerts` records no "last confirmed" timestamp, so from the table alone a
 * live alarm and a 108-day-old fossil look identical.
 *
 * That is not untidiness, it is the failure mode every alert exists to avoid.
 * Forty per cent of the surface was permanent noise, and the rational response
 * to a list that is mostly wrong is to stop reading it — at which point the
 * real alarms (a dead telemetry sensor, a runner twelve days behind) go unread
 * too. A channel degrades to the reliability of its worst entry.
 *
 * THE RULE
 * --------
 * A type in this registry must have a producer; a producer must use a type in
 * this registry. `scripts/test/alert-registry.ts` enforces both directions, so
 * retiring a feature turns CI red until its alert type is retired with it — and
 * `sweep-orphan-alerts` then clears the rows it left behind, rather than
 * relying on whoever deleted the feature to remember they existed.
 *
 * `producer` is the file that raises it, and it is checked: a path that no
 * longer contains the literal fails the build. That is the whole mechanism —
 * the registry cannot rot quietly because the test reads the code, not this
 * comment.
 */

export type AlertTypeSpec = {
  /** Human label for the type — what this alarm is about. */
  label: string;
  /** Repo-relative file that raises it. Asserted to exist AND contain the id. */
  producer: string;
  /**
   * Who acts on it. `system` alarms are the builder's (telemetry, runners,
   * repositories, model ids): /system lists them and /today links them in one
   * line. `operator` alerts are things the person decides, and /today lists
   * them. Today rendered all of them as equal cards — repo paths and
   * `npm run check:models` above "reach out to 6 people".
   */
  audience: "system" | "operator";
  /**
   * Set when the alert is a notification ABOUT a source the front door already
   * lists (lib/needs-you composes approvals and feedback triage directly).
   * Listing both counted one thing twice: live 2026-10-02 Today said "22 things
   * need you" with "7 actions are waiting for your approval" beside the seven
   * approvals, and "36 feedback items need triage" beside "6 to triage".
   */
  restates?: "approvals" | "feedback";
};

export const ALERT_TYPES = {
  telemetry_stale: {
    label: "A telemetry path stopped recording",
    audience: "system",
    producer: "src/app/api/crons/check-telemetry/route.ts",
  },
  runner_version_stale: {
    label: "A machine is running a Fleet Runner we replaced",
    audience: "system",
    producer: "src/app/api/crons/check-runner-version/route.ts",
  },
  project_repo_missing: {
    label: "A project points at a repository GitHub cannot find",
    audience: "system",
    producer: "src/app/api/crons/check-project-repos/route.ts",
  },
  model_rot: {
    label: "A pinned AI model id no longer exists upstream",
    audience: "system",
    producer: "src/app/api/crons/check-model-ids/route.ts",
  },
  runner_stall: {
    label: "A queued command is not being executed",
    audience: "system",
    producer: "src/app/api/crons/check-runner-stall/route.ts",
  },
  pending_approvals: {
    label: "Actions are waiting for the operator",
    audience: "operator",
    restates: "approvals",
    producer: "src/app/api/crons/check-pending-approvals/route.ts",
  },
  run_escalation: {
    label: "A project's escalation ladder reached the human rung",
    audience: "operator",
    producer: "src/db/queries/run-escalations.ts",
  },
  goal_capped: {
    label: "A goal stopped after too many attempts",
    audience: "operator",
    producer: "src/lib/orchestration/gate-and-close.ts",
  },
  new_feedback: {
    label: "New feedback needs triage",
    audience: "operator",
    restates: "feedback",
    producer: "src/lib/feedback/notify-new.ts",
  },
  studio_request: {
    label: "A studio request or partner application needs a person",
    audience: "operator",
    producer: "src/lib/studio/notify.ts",
  },
  fix_live: {
    label: "A visitor's fix reached the live site",
    audience: "operator",
    producer: "src/lib/feedback/notify-shipped.ts",
  },
  fix_deploy_failed: {
    label: "A merged fix failed to deploy — the site still shows the old version",
    audience: "operator",
    producer: "src/lib/feedback/notify-shipped.ts",
  },
  feedback_needs_you: {
    label: "Feedback work stalled or needs Check live",
    audience: "operator",
    producer: "src/lib/feedback/notify-needs-you.ts",
  },
  orangecat_link_broken: {
    label: "OrangeCat rejected the account's token — publishing is paused",
    audience: "system",
    producer: "src/lib/integrations/orangecat-identity.ts",
  },
} as const satisfies Record<string, AlertTypeSpec>;

export type AlertType = keyof typeof ALERT_TYPES;

export const ALERT_TYPE_IDS = Object.keys(ALERT_TYPES) as AlertType[];

/** An alert that only notifies about a source the front door already lists. */
export function alertRestatesListedSource(type: string): boolean {
  if (!isRegisteredAlertType(type)) return false;
  const spec: AlertTypeSpec = ALERT_TYPES[type];
  return spec.restates !== undefined;
}

/** The alert types /system owns. Anything not registered is treated as operator. */
export function isSystemAlertType(type: string): boolean {
  return isRegisteredAlertType(type) && ALERT_TYPES[type].audience === "system";
}

export function isRegisteredAlertType(type: string): type is AlertType {
  return Object.prototype.hasOwnProperty.call(ALERT_TYPES, type);
}
