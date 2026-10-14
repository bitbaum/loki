/**
 * What Loki does with an open package-update pull request, given the
 * project's setting and what the person decided — as pure functions, so the
 * whole decision table is a test and not a reading of the sync loop.
 *
 * Loki's only levers are the `hold` label (the fleet sweep merges nothing that
 * carries one) and, for a breaking update a person said yes to, the merge
 * button — the sweep never merges a breaking Dependabot update on its own.
 * Everything else is the sweep's job, and Loki leaves it to it.
 *
 * Two rules keep Loki from fighting people:
 *   - it removes only the `hold` it put on itself (`heldByLoki`); a hold label
 *     a person added — `hold`, `wip`, any of them — stays, and blocks Loki's
 *     own merge too;
 *   - if a person takes Loki's hold off on GitHub, Loki stands aside for that
 *     pull request: it does not put the hold back, and it does not merge it
 *     either — that was their call on GitHub, not the owner's yes in Loki.
 */
import {
  LOKI_HOLD_LABEL,
  PACKAGE_UPDATE_SETTING,
  RELEASED_ON_GITHUB,
  SWEEP_HOLD_LABELS,
  UPDATE_DECISION,
  type PackageUpdateSetting,
  type UpdateDecision,
} from "@/config/package-updates";

export type CiState = "pending" | "green" | "red" | "unknown";
export type UpdateRequestState = "open" | "held" | "approved" | "merged" | "closed";

/** The states in which the pull request is still open. */
export const OPEN_UPDATE_STATES: readonly UpdateRequestState[] = ["open", "held", "approved"];

/** GitHub conclusions that are not a reason to stop (fix-shipping-refresh reads checks the same way). */
const PASSING = new Set(["success", "neutral", "skipped"]);

/**
 * The checks on a pull request's head, summed up. `null` = could not read.
 * No checks at all is "unknown", never "green": absence of red is not
 * evidence of green.
 */
export function ciStateFrom(conclusions: readonly (string | null)[] | null): CiState {
  if (conclusions === null || conclusions.length === 0) return "unknown";
  if (conclusions.some((c) => c !== null && !PASSING.has(c))) return "red";
  if (conclusions.some((c) => c === null)) return "pending";
  return "green";
}

export type EnforcementInput = {
  setting: PackageUpdateSetting;
  /** Any update in the pull request is breaking. */
  breaking: boolean;
  /** The labels on the pull request now. */
  labels: readonly string[];
  /** Loki put the `hold` label on (recorded on the row). */
  heldByLoki: boolean;
  /** What the person decided on the Approvals card, if anything. */
  decision: UpdateDecision | null;
  ciState: CiState;
};

export type Enforcement = {
  /** Add Loki's hold, take it off, or leave the labels alone. */
  label: "add" | "remove" | "none";
  /** Merge it now (a breaking update a person approved, whose checks are green). */
  merge: boolean;
  /** `held_by_loki` after the label change succeeds. */
  heldByLoki: boolean;
  /** The decision to record — a person releasing Loki's hold on GitHub is recorded as "released". */
  decision: UpdateDecision | null;
  /** The request's state after the actions succeed (before a merge lands). */
  state: UpdateRequestState;
  /** One sentence for the person, when there is something to say. */
  note: string | null;
};

export const ENFORCEMENT_NOTES = {
  humanHold:
    "Someone put a hold label on this pull request on GitHub; Loki leaves it there. Remove it on GitHub to let the update merge.",
  waitingChecks: "Approved. Loki merges it when its checks pass.",
  redChecks:
    "Approved, but its checks failed — the project's code needs a change before this update can merge.",
  noChecks:
    "Approved, but the repository reports no checks, so nothing proves the update is safe. Merge it on GitHub if you are sure.",
  sweepMerges: "Approved. The fleet's auto-merge merges it when its checks pass.",
  releasedOnGithub:
    "Someone took Loki's hold off on GitHub, so Loki leaves this update alone. Merge or close it there.",
} as const;

/** The decision table. See the module comment for the two rules it keeps. */
export function decideEnforcement(input: EnforcementInput): Enforcement {
  const hasLokiLabel = input.labels.includes(LOKI_HOLD_LABEL);
  const lokiHolds = input.heldByLoki && hasLokiLabel;
  // A hold a person put on: any sweep hold label that is not Loki's own.
  const humanHold = input.labels.some(
    (l) => SWEEP_HOLD_LABELS.includes(l) && !(l === LOKI_HOLD_LABEL && lokiHolds),
  );

  let decision = input.decision;
  if (input.heldByLoki && !hasLokiLabel && decision !== UPDATE_DECISION.UPDATE) {
    decision = RELEASED_ON_GITHUB;
  }
  if (decision === RELEASED_ON_GITHUB) {
    return {
      label: "none",
      merge: false,
      heldByLoki: false,
      decision,
      state: humanHold ? "held" : "open",
      note: ENFORCEMENT_NOTES.releasedOnGithub,
    };
  }

  if (decision === UPDATE_DECISION.UPDATE) {
    const label = lokiHolds ? "remove" : "none";
    const merge = input.breaking && input.ciState === "green" && !humanHold;
    let note: string | null = null;
    if (humanHold) note = ENFORCEMENT_NOTES.humanHold;
    else if (!input.breaking) note = ENFORCEMENT_NOTES.sweepMerges;
    else if (input.ciState === "red") note = ENFORCEMENT_NOTES.redChecks;
    else if (input.ciState === "unknown") note = ENFORCEMENT_NOTES.noChecks;
    else if (input.ciState === "pending") note = ENFORCEMENT_NOTES.waitingChecks;
    return { label, merge, heldByLoki: false, decision, state: "approved", note };
  }

  const wantHold =
    decision === UPDATE_DECISION.STAY ||
    decision === UPDATE_DECISION.LATER ||
    input.setting !== PACKAGE_UPDATE_SETTING.AUTO ||
    input.breaking;

  if (wantHold) {
    // Loki adds its own `hold` even beside a person's `wip`: theirs may come
    // off for their own reasons, and the setting still has to hold.
    if (!hasLokiLabel) {
      return { label: "add", merge: false, heldByLoki: true, decision, state: "held", note: null };
    }
    return {
      label: "none",
      merge: false,
      heldByLoki: input.heldByLoki,
      decision,
      state: "held",
      note: null,
    };
  }

  if (lokiHolds) {
    return {
      label: "remove",
      merge: false,
      heldByLoki: false,
      decision,
      state: humanHold ? "held" : "open",
      note: humanHold ? ENFORCEMENT_NOTES.humanHold : null,
    };
  }
  return {
    label: "none",
    merge: false,
    heldByLoki: false,
    decision,
    state: humanHold ? "held" : "open",
    note: null,
  };
}

/**
 * Does this request belong on Approvals now? Held, not decided (or "Not now"
 * has run out), and something the person is asked about: every update on
 * "Ask me", and a breaking update on "Automatic". "Stay on these versions"
 * asks nothing — the person already answered for every update.
 */
export function needsDecision(
  row: {
    state: UpdateRequestState;
    decision: UpdateDecision | null;
    snoozedUntil: Date | null;
    packages: readonly { breaking: boolean }[];
  },
  setting: PackageUpdateSetting,
  nowMs: number,
): boolean {
  if (row.state !== "held") return false;
  if (setting === PACKAGE_UPDATE_SETTING.PINNED) return false;
  if (
    row.decision === UPDATE_DECISION.STAY ||
    row.decision === UPDATE_DECISION.UPDATE ||
    row.decision === RELEASED_ON_GITHUB
  ) {
    return false;
  }
  if (row.decision === UPDATE_DECISION.LATER && row.snoozedUntil) {
    if (row.snoozedUntil.getTime() > nowMs) return false;
  }
  return setting === PACKAGE_UPDATE_SETTING.ASK || row.packages.some((p) => p.breaking);
}

export type UpdateStatus = {
  label: string;
  tone: "positive" | "warning" | "negative" | "neutral";
};

/** One phrase for an open update, for the project panel and the package page. */
export function updateStatus(
  row: { state: UpdateRequestState; decision: UpdateDecision | null; ciState: CiState },
  setting: PackageUpdateSetting,
): UpdateStatus {
  if (row.state === "merged") return { label: "merged", tone: "positive" };
  if (row.state === "closed") return { label: "closed", tone: "neutral" };
  if (row.state === "held") {
    if (row.decision === UPDATE_DECISION.STAY) {
      return { label: "staying on this version", tone: "neutral" };
    }
    if (setting === PACKAGE_UPDATE_SETTING.PINNED) {
      return { label: "held — staying on these versions", tone: "neutral" };
    }
    return { label: "held for you", tone: "warning" };
  }
  if (row.ciState === "red") return { label: "tests failed", tone: "negative" };
  if (row.ciState === "green") return { label: "ready", tone: "positive" };
  return { label: "waiting on tests", tone: "neutral" };
}

/** The checks on an update, in words. */
export const CI_STATE_LABELS: Record<CiState, string> = {
  green: "Checks passed",
  pending: "Checks running",
  red: "Checks failed",
  unknown: "No checks reported",
};

/** Why an update is on Approvals — the one line that says what the person is asked. */
export function whyAsked(packages: readonly { breaking: boolean }[]): string {
  return packages.some((p) => p.breaking)
    ? "A breaking update: the project's code may need changes to take it."
    : "This project asks before each update.";
}
