import type { RunnerChannel } from "@/db/schema/pending-commands";
import type { BuilderChannelPresence } from "@/lib/builder-presence";
import { isCloneableGitUrl } from "@/lib/git-url";
import { DEFAULT_BUILDER_CHANNEL, isBuilderChannel } from "@/lib/constants/statuses";
import { BOX_DEV_ROOT, sanitizeWorkspaceKey } from "@/lib/agent-execution/box-workspace-path";
import path from "path";

const CLOUD_BUILDER_PRIVATE_MESSAGE =
  "Cloud builder access is private for this account. Connect Fleet Runner on this computer to run agent work.";

const BUILDER_REQUIRED_MESSAGE =
  "No builder is connected for this account. Open Fleet Runner on this computer, then dispatch again.";

/**
 * May this account use FLEET-OWNED infrastructure — the shared cloud builder,
 * and the org GitHub token that creates repositories in the fleet's
 * organisation? Founder or explicit allowlist, nothing else.
 *
 * Separate from getExecutionAccess because that one also reads runner
 * presence, which a GitHub write has no use for; and because the question
 * "may this account act as the fleet" deserves one name that every caller
 * asks by, rather than each re-deriving `isDefault || allowlist`.
 */
export async function isFleetInfrastructureAllowed(userId: string): Promise<boolean> {
  const { getUserById } = await import("@/db/queries/users");
  const user = await getUserById(userId).catch(() => null);
  return !!user?.isDefault || cloudBuilderAllowlist().has(userId);
}

function cloudBuilderAllowlist(): Set<string> {
  return new Set(
    (process.env.LOKI_CLOUD_BUILDER_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export type ExecutionAccess = {
  userId: string;
  cloudBuilderAllowed: boolean;
  presence: BuilderChannelPresence;
};

export type QueuedExecutionDecision =
  | {
      ok: true;
      channel?: RunnerChannel;
      runnerConnected: boolean;
      /** The stored choice was offline, so the work went to this builder's
       *  online sibling instead (see `offlineFallback`). */
      reroutedFrom?: RunnerChannel;
      access: ExecutionAccess;
    }
  | {
      ok: false;
      status: 403 | 409;
      code: "cloud-builder-private" | "builder-required";
      message: string;
      access: ExecutionAccess;
    };

export async function getExecutionAccess(userId: string): Promise<ExecutionAccess> {
  const [{ getUserById }, { getBuilderPresence }] = await Promise.all([
    import("@/db/queries/users"),
    import("@/db/queries/runner-presence"),
  ]);
  const [user, presence] = await Promise.all([
    getUserById(userId),
    getBuilderPresence(userId).catch(() => ({ cloud: false, local: false, any: false })),
  ]);
  const cloudBuilderAllowed = !!user?.isDefault || cloudBuilderAllowlist().has(userId);
  return { userId, cloudBuilderAllowed, presence };
}

/**
 * SSOT for queued execution routing on the hosted web app.
 *
 * The always-on box-runner is not a tenant boundary. Until hosted execution is
 * sandboxed per tenant, non-founder accounts must run work through their own
 * Fleet Runner ("local" channel) instead of the shared cloud builder.
 */
export async function resolveQueuedExecution(
  userId: string,
  options: {
    requestedChannel?: RunnerChannel | null;
    defaultChannel?: RunnerChannel;
    project?: ProjectLocus;
    offlineFallback?: RunnerChannel | null;
  } = {},
): Promise<QueuedExecutionDecision> {
  const access = await getExecutionAccess(userId);
  return decideQueuedExecution(access, options);
}

export function decideQueuedExecution(
  access: ExecutionAccess,
  options: {
    requestedChannel?: RunnerChannel | null;
    defaultChannel?: RunnerChannel;
    /**
     * Pass the project instead of a precomputed defaultChannel and the decision
     * is made here, where presence is already loaded — one routing rule for
     * every caller rather than each route deriving its own.
     */
    project?: ProjectLocus;
    /**
     * A builder that may take the work when the chosen one is offline right
     * now — only ever the project's own `offlineFallbackChannel`, which is
     * null for a locked project. The chat says what happened, so the
     * operator can send it back; the stored preference itself is untouched.
     */
    offlineFallback?: RunnerChannel | null;
  } = {},
): QueuedExecutionDecision {
  const requested = options.requestedChannel ?? null;
  const defaultChannel =
    options.defaultChannel ??
    ("project" in options ? pickDispatchChannel(options.project) : undefined);

  if (!access.cloudBuilderAllowed) {
    if (requested === "cloud") {
      return {
        ok: false,
        status: 403,
        code: "cloud-builder-private",
        message: CLOUD_BUILDER_PRIVATE_MESSAGE,
        access,
      };
    }
    if (access.presence.local) {
      return {
        ok: true,
        channel: "local",
        runnerConnected: true,
        access,
      };
    }
    return {
      ok: false,
      status: 409,
      code: "builder-required",
      message: BUILDER_REQUIRED_MESSAGE,
      access,
    };
  }

  const chosen = requested ?? defaultChannel;
  const fallback = options.offlineFallback ?? null;
  // The chosen builder is off and its sibling is on: the work goes where it
  // can start now. Without this a phone tap sat "Queued for this computer"
  // for 106 minutes beside a cloud builder reading "online · not executing"
  // (operator, 2026-10-09) — the queue was waiting for a laptop that was shut.
  const reroute =
    chosen !== undefined &&
    fallback !== null &&
    fallback !== chosen &&
    !access.presence[chosen] &&
    access.presence[fallback] &&
    (fallback !== "cloud" || access.cloudBuilderAllowed);
  const channel = reroute ? fallback : chosen;
  const runnerConnected = channel ? access.presence[channel] : access.presence.any;
  return {
    ok: true,
    ...(channel ? { channel } : {}),
    runnerConnected,
    ...(reroute && chosen ? { reroutedFrom: chosen } : {}),
    access,
  };
}

/**
 * The one routing rule, with a caller-supplied floor: locus lock → the
 * project's stored builder preference → `fallback`.
 *
 * The return type is deliberately NOT nullable. An absent channel does not mean
 * "any builder, pick a good one" — it means the row is claimable by ALL of them
 * concurrently, which is a race the always-on box loses to whichever desktop is
 * polling. Callers used to spread `...(ch ? {channel: ch} : {})` and silently
 * emit unrouted commands; making null unrepresentable here is what stops that
 * from coming back.
 */
export function projectPreferredChannel(
  project: ProjectLocus,
  fallback: RunnerChannel = DEFAULT_BUILDER_CHANNEL,
): RunnerChannel {
  return projectChannelLock(project) ?? storedBuilderPref(project) ?? fallback;
}

export type ProjectLocus =
  | {
      dirPath?: string | null;
      gitUrl?: string | null;
      /** `user_projects.builder_pref`: the operator's stored tier. Null = cloud. */
      builderPref?: string | null;
    }
  | null
  | undefined;

/** The stored preference, or null when the row says nothing or says nonsense. */
function storedBuilderPref(project: ProjectLocus): RunnerChannel | null {
  const pref = project?.builderPref?.trim();
  return pref && isBuilderChannel(pref) ? pref : null;
}

/**
 * Physics, not preference: the ONE channel that can materialize this project,
 * or null when either could.
 *
 * Separated from the routing policy below because a lock must never lose to a
 * presence check. Routing "this project is only on your laptop" to the cloud
 * because the laptop is asleep would re-create the 2026-07-14 misroute — the
 * cloud builder clone-fails and hands the agent an empty directory to "work" in.
 * A locked dispatch waits for its machine. That is correct: there is nowhere
 * else for it to go.
 */
export function projectChannelLock(project: ProjectLocus): RunnerChannel | null {
  if (isBoxRootedDir(project?.dirPath)) return "cloud";
  if (project?.dirPath && !isCloneableGitUrl(project.gitUrl)) return "local";
  return null;
}

/**
 * A dirPath under the box's clone root was written by the product itself
 * (kickoff provision sets `dirPath = LOKI_BOX_DEV_ROOT/<slug>`), so the
 * workspace exists on the box and nowhere else. The desktop runner does not
 * clone on demand: routed there, it launched claude in a directory that does
 * not exist and reported "inject did not stick" — three times in a row for
 * velokiosk-sep10 on 2026-09-10 while the box sat idle. Explicit env only:
 * the default clone root is `~/dev`, which on a laptop is the laptop's tree.
 */
export function isBoxRootedDir(dirPath: string | null | undefined): boolean {
  const root = process.env.LOKI_BOX_DEV_ROOT?.trim().replace(/\/+$/, "");
  if (!root || !dirPath) return false;
  return dirPath === root || dirPath.startsWith(`${root}/`);
}

/**
 * The directory a builder materializes `name` into when the project has no
 * dirPath but a cloneable repo — the same path `ensureBoxWorkspace` and
 * `resolveRunnerWorkspaceDir` derive on the runner, so the queue can carry a
 * real `dir` and the executor enqueues a DISPATCH (cold start: clone → owned
 * PTY → agent) instead of a bare INJECT (which can only puppet an existing
 * zellij tab — the 2026-09-10 Heidi dead end on both channels).
 * Null when the project cannot be materialized at all.
 */
export function coldStartWorkspaceDir(
  name: string,
  gitUrl: string | null | undefined,
): string | null {
  if (!isCloneableGitUrl(gitUrl)) return null;
  return path.join(BOX_DEV_ROOT, sanitizeWorkspaceKey(name));
}

/**
 * Where should this dispatch run? The single answer for every caller.
 *
 * Two tiers, both stored, neither guessed:
 *
 *   1. Locus lock — physics. A checkout that exists on exactly one machine can
 *      only run there (a laptop-only tree stays local; a tree under the box's
 *      clone root stays cloud). Routing "this project is only on your laptop"
 *      to the cloud because the laptop is asleep re-creates the 2026-07-14
 *      misroute: the cloud builder clone-fails and hands the agent an empty
 *      directory. A locked dispatch waits for its machine.
 *   2. The project's stored preference (`user_projects.builder_pref`), else the
 *      cloud floor.
 *
 * Runner presence is deliberately NOT an input. "A desktop is connected" was
 * read as "the operator is at the laptop", and every misroute this subsystem
 * has shipped came from that inference: a phone dispatch landing on a laptop
 * nobody was watching (killed by the lid), a repo-only project pinned to a
 * laptop that then hunted for a zellij tab that could not exist, and a stored
 * kickoff sent to a runner that does not clone. If the chosen builder is
 * offline the command queues for it visibly (`runnerConnected: false`); it is
 * never rerouted behind the operator's back.
 */
export function pickDispatchChannel(project: ProjectLocus): RunnerChannel {
  return projectPreferredChannel(project);
}

/**
 * Where this project's work may go when its chosen builder is offline — or
 * null when it must wait.
 *
 * Only a PREFERENCE for this computer falls through, and only to the cloud,
 * and only when the cloud can materialize the project on its own (a cloneable
 * repository). A locus lock never falls through: that is the 2026-07-14
 * misroute, and the lock exists to prevent it. The other direction (cloud
 * preference, cloud offline) never falls through either — the desktop runner
 * does not clone on demand, so a laptop that has no checkout has nowhere to
 * put the work.
 */
export function offlineFallbackChannel(project: ProjectLocus): RunnerChannel | null {
  if (projectChannelLock(project) !== null) return null;
  if (projectPreferredChannel(project) !== "local") return null;
  return isCloneableGitUrl(project?.gitUrl) ? "cloud" : null;
}

export function executionAccessErrorBody(
  decision: Extract<QueuedExecutionDecision, { ok: false }>,
) {
  return {
    ok: false,
    error: decision.message,
    code: decision.code,
    warning: decision.code,
    cloudBuilderAllowed: decision.access.cloudBuilderAllowed,
    builderPresence: decision.access.presence,
  };
}
