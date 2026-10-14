/**
 * How shared-package updates reach a project — the one place the choices, their
 * words and the labels Loki puts on GitHub are defined.
 *
 * The update pull requests themselves are Dependabot's, and the merging is the
 * fleet's auto-merge sweep (bitbaum/fleet scripts/ci/auto-merge-sweep.sh): it
 * merges a green PR unless it carries one of SWEEP_HOLD_LABELS, and it merges a
 * Dependabot PR on its own only when no update in it is breaking. Loki adds the
 * policy on top and nothing else: it puts its own `hold` on what should wait,
 * takes off only the holds it put on, and merges a breaking update itself only
 * after a person said yes.
 */
import { z } from "zod";

export const PACKAGE_UPDATE_SETTING = {
  AUTO: "auto",
  ASK: "ask",
  PINNED: "pinned",
} as const;
export type PackageUpdateSetting =
  (typeof PACKAGE_UPDATE_SETTING)[keyof typeof PACKAGE_UPDATE_SETTING];

/** Every new project, and every project that never chose. */
export const DEFAULT_PACKAGE_UPDATE_SETTING: PackageUpdateSetting = PACKAGE_UPDATE_SETTING.AUTO;

/**
 * The three choices, in the order they are offered. `consequence` is the one
 * line under the control: what will happen, not what the option is called.
 */
export const PACKAGE_UPDATE_SETTINGS: ReadonlyArray<{
  id: PackageUpdateSetting;
  label: string;
  consequence: string;
}> = [
  {
    id: PACKAGE_UPDATE_SETTING.AUTO,
    label: "Automatic",
    consequence: "Updates merge themselves when this project's tests pass.",
  },
  {
    id: PACKAGE_UPDATE_SETTING.ASK,
    label: "Ask me",
    consequence: "Each update waits for you on Approvals.",
  },
  {
    id: PACKAGE_UPDATE_SETTING.PINNED,
    label: "Stay on these versions",
    consequence: "Nothing updates until you change this.",
  },
];

/** Said under every choice: the one exception none of them overrides. */
export const BREAKING_ALWAYS_ASKS =
  "A breaking update (a new major version, or a new minor under 1.0) always waits for you.";

/** Said after a change: the setting reaches open pull requests on the next read. */
export const SETTING_APPLIES_WHEN =
  "Applies to open updates the next time Loki reads the repository — within 15 minutes.";

const SETTING_IDS = PACKAGE_UPDATE_SETTINGS.map((s) => s.id) as [
  PackageUpdateSetting,
  ...PackageUpdateSetting[],
];

/** The body of PATCH /api/projects/[id]/package-updates. */
export const PackageUpdateSettingBody = z.object({ setting: z.enum(SETTING_IDS) });

/**
 * A stored value read back. The column has no CHECK constraint (the values are
 * owned here, as with entities.auto_inject_mode_override), so a value this
 * file no longer knows reads as "ask": an unknown setting is never permission
 * to merge.
 */
export function readPackageUpdateSetting(raw: string | null | undefined): PackageUpdateSetting {
  return SETTING_IDS.includes(raw as PackageUpdateSetting)
    ? (raw as PackageUpdateSetting)
    : PACKAGE_UPDATE_SETTING.ASK;
}

/** The label Loki puts on a pull request to stop the sweep merging it. */
export const LOKI_HOLD_LABEL = "hold";

/** Every label the fleet sweep treats as "do not merge" (auto-merge-sweep.sh HOLD_LABELS). */
export const SWEEP_HOLD_LABELS: readonly string[] = ["hold", "no-automerge", "do-not-merge", "wip"];

/** The only author whose pull requests Loki treats as package updates. */
export const DEPENDABOT_LOGIN = "dependabot[bot]";

/** "Not now" hides an update from Approvals for this long. */
export const UPDATE_SNOOZE_DAYS = 7;

/** What a person can do with a held update, from its card on Approvals. */
export const UPDATE_DECISION = {
  /** Take it: release the hold, and merge a breaking one once its checks pass. */
  UPDATE: "update",
  /** Keep it held and out of the queue for UPDATE_SNOOZE_DAYS. */
  LATER: "later",
  /** Tell Dependabot to stop proposing this version; it closes the pull request. */
  STAY: "stay",
} as const;
/** One of the three answers a card offers. */
export type UpdateAction = (typeof UPDATE_DECISION)[keyof typeof UPDATE_DECISION];

/**
 * Recorded, never offered: someone took Loki's hold off on GitHub. Loki then
 * stands aside for that pull request — it does not put the hold back (that
 * would fight a person) and does not merge it (a breaking update still needs
 * the owner's yes in Loki, and whoever released it can merge it there).
 */
export const RELEASED_ON_GITHUB = "released";

/** What a request's `decision` column can hold. */
export type UpdateDecision = UpdateAction | typeof RELEASED_ON_GITHUB;

export const UPDATE_ACTIONS: readonly UpdateAction[] = [
  UPDATE_DECISION.UPDATE,
  UPDATE_DECISION.LATER,
  UPDATE_DECISION.STAY,
];

export const UpdateDecisionBody = z.object({
  decision: z.enum([UPDATE_DECISION.UPDATE, UPDATE_DECISION.LATER, UPDATE_DECISION.STAY]),
});

export const UPDATE_DECISION_LABELS: Record<UpdateAction, string> = {
  update: "Update",
  later: "Not now",
  stay: "Stay on this version",
};

/** Said when Loki has no GitHub access that may write to a project's repository. */
export const CANNOT_WRITE_MESSAGE =
  "Loki has no GitHub access that can write to this repository, so it cannot hold or merge updates there. Connect GitHub with an account that can.";

/** How often the box reads update pull requests (scripts/install-hetzner-crons.sh). */
export const UPDATE_SYNC_SCHEDULE = "*:07/15";
