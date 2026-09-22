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
};

export const ALERT_TYPES = {
  telemetry_stale: {
    label: "A telemetry path stopped recording",
    producer: "src/app/api/crons/check-telemetry/route.ts",
  },
  runner_version_stale: {
    label: "A machine is running a Fleet Runner we replaced",
    producer: "src/app/api/crons/check-runner-version/route.ts",
  },
  project_repo_missing: {
    label: "A project points at a repository GitHub cannot find",
    producer: "src/app/api/crons/check-project-repos/route.ts",
  },
  model_rot: {
    label: "A pinned AI model id no longer exists upstream",
    producer: "src/app/api/crons/check-model-ids/route.ts",
  },
  runner_stall: {
    label: "A queued command is not being executed",
    producer: "src/app/api/crons/check-runner-stall/route.ts",
  },
  pending_approvals: {
    label: "Actions are waiting for the operator",
    producer: "src/app/api/crons/check-pending-approvals/route.ts",
  },
  run_escalation: {
    label: "A project's escalation ladder reached the human rung",
    producer: "src/db/queries/run-escalations.ts",
  },
  goal_capped: {
    label: "A goal stopped after too many attempts",
    producer: "src/lib/orchestration/gate-and-close.ts",
  },
  new_feedback: {
    label: "New feedback needs triage",
    producer: "src/lib/feedback/notify-new.ts",
  },
  fix_live: {
    label: "A visitor's fix reached the live site",
    producer: "src/lib/feedback/notify-shipped.ts",
  },
  fix_deploy_failed: {
    label: "A merged fix failed to deploy — the site still shows the old version",
    producer: "src/lib/feedback/notify-shipped.ts",
  },
  feedback_needs_you: {
    label: "Feedback work stalled or needs Check live",
    producer: "src/lib/feedback/notify-needs-you.ts",
  },
  orangecat_link_broken: {
    label: "OrangeCat rejected the account's token — publishing is paused",
    producer: "src/lib/integrations/orangecat-identity.ts",
  },
} as const satisfies Record<string, AlertTypeSpec>;

export type AlertType = keyof typeof ALERT_TYPES;

export const ALERT_TYPE_IDS = Object.keys(ALERT_TYPES) as AlertType[];

export function isRegisteredAlertType(type: string): type is AlertType {
  return Object.prototype.hasOwnProperty.call(ALERT_TYPES, type);
}
