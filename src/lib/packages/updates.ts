/**
 * Package updates: read a project's open Dependabot pull requests, apply the
 * project's update setting to them, and carry out what a person decided.
 *
 * Loki makes no pull requests and merges almost nothing. Dependabot proposes;
 * the fleet sweep merges green, unheld, non-breaking updates. Loki's part is
 * the policy between them (./update-policy.ts): a `hold` label where the
 * project's setting or a breaking step says wait, removed again only by Loki
 * and only when it put it there, and a merge for a breaking update a person
 * approved once its checks are green — the one merge the sweep will not do.
 *
 * Everything that touches GitHub or the database comes in through `UpdateGithub`
 * and `UpdateStore`, so this module is tested with fakes.
 */
import {
  CANNOT_WRITE_MESSAGE,
  DEPENDABOT_LOGIN,
  LOKI_HOLD_LABEL,
  SWEEP_HOLD_LABELS,
  UPDATE_DECISION,
  UPDATE_SNOOZE_DAYS,
  readPackageUpdateSetting,
  type UpdateAction,
} from "@/config/package-updates";
import type { NewPackageUpdateRequestRow, PackageUpdateRequestRow } from "@/db/schema";
import type { RepoRef } from "@/lib/github-repo-ref";
import {
  anyBreaking,
  ignoreCommands,
  isGroupedTitle,
  matchBumps,
  parseDependabotBumps,
} from "./dependabot";
import type { GithubPull, UpdateGithub, WriteResult } from "./update-github";
import {
  OPEN_UPDATE_STATES,
  ciStateFrom,
  decideEnforcement,
  type CiState,
  type UpdateRequestState,
} from "./update-policy";

export interface UpdateStore {
  listForProject(projectId: string): Promise<PackageUpdateRequestRow[]>;
  listPackageKeys(
    projectId: string,
  ): Promise<Array<{ packageName: string; depName: string | null }>>;
  upsert(values: NewPackageUpdateRequestRow): Promise<void>;
  patch(
    id: string,
    patch: Partial<
      Pick<PackageUpdateRequestRow, "decision" | "decidedAt" | "snoozedUntil" | "detail" | "state">
    >,
  ): Promise<void>;
}

export type UpdateContext = {
  userId: string;
  project: { id: string; packageUpdates: string | null };
  ref: RepoRef;
  /** Names in the fleet catalogue. */
  catalogueNames: ReadonlySet<string>;
  gh: UpdateGithub;
  store: UpdateStore;
  now: Date;
};

export const UPDATE_MESSAGES = {
  cannotWrite: CANNOT_WRITE_MESSAGE,
  githubUnreadable: "GitHub did not answer about this pull request. Try again in a minute.",
  merged: "Merged.",
  closedAlready: "This pull request was already closed on GitHub.",
  mergedAlready: "This update was already merged.",
  stay: "Dependabot was told to stop proposing this version; it closes the pull request.",
} as const;

export function isDependabotPull(pull: Pick<GithubPull, "authorLogin" | "authorType">): boolean {
  return pull.authorLogin === DEPENDABOT_LOGIN && pull.authorType === "Bot";
}

function writeFailure(what: string, res: WriteResult, canWrite: boolean): string {
  if (res.ok) return "";
  if (!canWrite || res.status === 401 || res.status === 403 || res.status === 404) {
    return UPDATE_MESSAGES.cannotWrite;
  }
  return `GitHub refused to ${what}: ${res.message}`;
}

/** The catalogue name each dependency key stands for, from the project's last read. */
function depNameMap(keys: ReadonlyArray<{ packageName: string; depName: string | null }>) {
  const out = new Map<string, string>();
  for (const k of keys)
    if (k.depName && k.depName !== k.packageName) out.set(k.depName, k.packageName);
  return out;
}

type Reconciled = {
  values: NewPackageUpdateRequestRow;
  state: UpdateRequestState;
  detail: string | null;
  /** A write GitHub refused (the label or the merge); `detail` says which. */
  failed: boolean;
};

/**
 * Bring one open pull request in line with the project's setting and the
 * person's decision, and say what to record. Null when it updates no fleet
 * package (it is not Loki's business).
 */
async function reconcilePull(
  pull: GithubPull,
  existing: PackageUpdateRequestRow | undefined,
  ctx: UpdateContext,
  depNames: ReadonlyMap<string, string>,
  decisionOverride?: UpdateAction,
): Promise<Reconciled | null> {
  const bumps = matchBumps(
    parseDependabotBumps(pull.title, pull.body),
    ctx.catalogueNames,
    depNames,
  );
  if (!bumps.some((b) => b.fleet)) return null;
  const breaking = anyBreaking(bumps);

  // A finished verdict on the same commit does not change; anything else is asked again.
  let ciState: CiState;
  if (
    existing &&
    existing.headSha === pull.headSha &&
    (existing.ciState === "green" || existing.ciState === "red")
  ) {
    ciState = existing.ciState;
  } else {
    ciState = pull.headSha
      ? ciStateFrom(await ctx.gh.checkConclusions(ctx.ref, pull.headSha))
      : "unknown";
  }

  const previousDecision = existing?.decision ?? null;
  const plan = decideEnforcement({
    setting: readPackageUpdateSetting(ctx.project.packageUpdates),
    breaking,
    labels: pull.labels,
    heldByLoki: existing?.heldByLoki ?? false,
    decision: decisionOverride ?? previousDecision,
    ciState,
  });

  let heldByLoki = plan.heldByLoki;
  let state = plan.state;
  let detail = plan.note;
  let failed = false;
  if (plan.label === "add") {
    const res = await ctx.gh.addLabel(ctx.ref, pull.number, LOKI_HOLD_LABEL);
    if (!res.ok) {
      failed = true;
      heldByLoki = existing?.heldByLoki ?? false;
      // Not held by Loki — but still held if a person's hold label is on it.
      state = pull.labels.some((l) => SWEEP_HOLD_LABELS.includes(l)) ? "held" : "open";
      detail = writeFailure("hold this update", res, ctx.gh.canWrite);
    }
  } else if (plan.label === "remove") {
    const res = await ctx.gh.removeLabel(ctx.ref, pull.number, LOKI_HOLD_LABEL);
    if (!res.ok) {
      failed = true;
      heldByLoki = true;
      state = plan.decision === UPDATE_DECISION.UPDATE ? "approved" : "held";
      detail = writeFailure("take the hold off", res, ctx.gh.canWrite);
    }
  }
  if (plan.merge && !failed) {
    const res = await ctx.gh.merge(ctx.ref, pull.number, pull.title);
    if (res.ok) {
      state = "merged";
      detail = "Merged by Loki on your approval.";
    } else {
      failed = true;
      detail = writeFailure("merge it", res, ctx.gh.canWrite);
    }
  }

  const decisionChanged = plan.decision !== previousDecision;
  return {
    state,
    detail,
    failed,
    values: {
      userId: ctx.userId,
      projectId: ctx.project.id,
      prNumber: pull.number,
      prUrl: pull.url,
      title: pull.title.slice(0, 300),
      headSha: pull.headSha,
      packages: bumps,
      ciState,
      state,
      heldByLoki,
      decision: plan.decision,
      decidedAt: decisionChanged ? ctx.now : (existing?.decidedAt ?? null),
      snoozedUntil:
        plan.decision === UPDATE_DECISION.LATER ? (existing?.snoozedUntil ?? null) : null,
      detail,
      openedAt: pull.createdAt ? new Date(pull.createdAt) : (existing?.openedAt ?? null),
      observedAt: ctx.now,
    },
  };
}

export type ProjectUpdatesResult = {
  /** Open update pull requests Loki tracks for the project. */
  open: number;
  /** …of which Loki is holding. */
  held: number;
  /** Set when the pull requests could not be read at all. */
  error?: string;
};

/**
 * Read the project's open Dependabot pull requests and apply its setting.
 * A pull request Loki tracked that is no longer open is looked up once, to
 * record whether it merged, and is then terminal.
 */
export async function syncProjectUpdates(ctx: UpdateContext): Promise<ProjectUpdatesResult> {
  const [existing, keys] = await Promise.all([
    ctx.store.listForProject(ctx.project.id),
    ctx.store.listPackageKeys(ctx.project.id),
  ]);
  // A project built from no fleet package has no update of one to read: no request spent.
  if (keys.length === 0 && !existing.some((r) => OPEN_UPDATE_STATES.includes(r.state))) {
    return { open: 0, held: 0 };
  }
  let pulls: GithubPull[];
  try {
    pulls = await ctx.gh.listOpenPulls(ctx.ref);
  } catch (err) {
    return { open: 0, held: 0, error: err instanceof Error ? err.message : "unreadable" };
  }
  const depNames = depNameMap(keys);
  const byNumber = new Map(existing.map((r) => [r.prNumber, r]));
  const seen = new Set<number>();
  let open = 0;
  let held = 0;
  for (const pull of pulls) {
    if (!isDependabotPull(pull)) continue;
    const out = await reconcilePull(pull, byNumber.get(pull.number), ctx, depNames);
    if (!out) continue;
    await ctx.store.upsert(out.values);
    seen.add(pull.number);
    if (out.state !== "merged") open++;
    if (out.state === "held") held++;
  }
  for (const row of existing) {
    if (seen.has(row.prNumber) || !OPEN_UPDATE_STATES.includes(row.state)) continue;
    const pull = await ctx.gh.getPull(ctx.ref, row.prNumber);
    if (!pull || pull.state !== "closed") continue;
    await ctx.store.patch(row.id, { state: pull.merged ? "merged" : "closed", detail: null });
  }
  return { open, held };
}

export type DecisionResult = { ok: boolean; message: string; state: UpdateRequestState };

/**
 * Carry out a person's decision on one held update. The pull request is read
 * fresh first — a decision acts on GitHub as it is now, not as Loki last saw it.
 */
export async function applyUpdateDecision(
  ctx: UpdateContext,
  row: PackageUpdateRequestRow,
  decision: UpdateAction,
): Promise<DecisionResult> {
  if (decision === UPDATE_DECISION.LATER) {
    const until = new Date(ctx.now.getTime() + UPDATE_SNOOZE_DAYS * 86_400_000);
    await ctx.store.patch(row.id, {
      decision,
      decidedAt: ctx.now,
      snoozedUntil: until,
      detail: null,
    });
    return {
      ok: true,
      state: row.state,
      message: `Hidden from Approvals for ${UPDATE_SNOOZE_DAYS} days. It stays held until then.`,
    };
  }
  if (!ctx.gh.canWrite)
    return { ok: false, state: row.state, message: UPDATE_MESSAGES.cannotWrite };

  const pull = await ctx.gh.getPull(ctx.ref, row.prNumber);
  if (!pull) return { ok: false, state: row.state, message: UPDATE_MESSAGES.githubUnreadable };
  if (pull.state === "closed") {
    const state = pull.merged ? "merged" : "closed";
    await ctx.store.patch(row.id, { state, detail: null });
    return {
      ok: true,
      state,
      message: pull.merged ? UPDATE_MESSAGES.mergedAlready : UPDATE_MESSAGES.closedAlready,
    };
  }

  if (decision === UPDATE_DECISION.STAY) {
    for (const body of ignoreCommands(row.packages, isGroupedTitle(pull.title))) {
      const res = await ctx.gh.comment(ctx.ref, row.prNumber, body);
      if (!res.ok) {
        return {
          ok: false,
          state: row.state,
          message: writeFailure("take the comment for Dependabot", res, ctx.gh.canWrite),
        };
      }
    }
  }

  const keys = await ctx.store.listPackageKeys(ctx.project.id);
  const out = await reconcilePull(pull, row, ctx, depNameMap(keys), decision);
  if (!out) {
    // Dependabot rewrote it and no fleet package is left in it.
    await ctx.store.patch(row.id, { decision, decidedAt: ctx.now, state: "closed", detail: null });
    return {
      ok: true,
      state: "closed",
      message: "This pull request no longer updates a fleet package.",
    };
  }
  await ctx.store.upsert(out.values);
  let message: string;
  if (out.failed) message = out.detail ?? UPDATE_MESSAGES.cannotWrite;
  else if (decision === UPDATE_DECISION.STAY) message = UPDATE_MESSAGES.stay;
  else if (out.state === "merged") message = UPDATE_MESSAGES.merged;
  else message = out.detail ?? "Approved.";
  return { ok: !out.failed, state: out.state, message };
}
