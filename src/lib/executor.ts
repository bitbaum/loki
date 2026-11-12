/**
 * Typed command executor — the boundary between "what to do" and "how to do it."
 *
 * Local runtime:  commands are written straight into the owned agent PTY.
 * Remote (cloud host): commands write to pending_commands in Postgres; the local runner picks them up.
 *
 * Callers express intent once. The executor routes to the correct mechanism.
 */

import { isRuntimeAvailable } from "@/lib/runtime";
import { DEFAULT_ADAPTER_ID } from "@/lib/orchestration";
import { enqueueInjectCommand, enqueueDispatchCommand } from "@/db/queries/pending-commands";
import type { InjectPayload, RunnerChannel } from "@/db/schema/pending-commands";
import { resolveQueuedExecution } from "@/lib/execution-access";
import { planParallelRun } from "@/lib/orchestration/parallel-run";
import {
  busyPlacement,
  type DispatchSession,
  type WhenBusy,
} from "@/lib/orchestration/busy-placement";
import { MAX_PARALLEL_LANES_PER_PROJECT } from "@/lib/run-tab";

export type ExecuteResult =
  | { ok: true; mode: "direct" }
  // `runnerConnected` tells the caller whether a live Fleet Runner exists to
  // drain this queued command. false = it will sit in pending_commands until a
  // runner reconnects. Callers MUST surface that so a dispatch to an offline
  // runner is never a silent success (the "queued into the void" bug).
  | {
      ok: true;
      mode: "queued";
      commandId: string;
      runnerConnected: boolean;
      /** The builder the row was actually given. */
      channel?: RunnerChannel;
      /** Set when the chosen builder was offline and its online sibling took
       *  the work (execution-access offlineFallback). */
      reroutedFrom?: RunnerChannel;
      /** Set when a busy project got this run its own lane (planParallelRun):
       *  the derived tab it will run in. Absent = it waits its turn. */
      parallelTab?: string;
    }
  | { ok: false; mode: "direct" | "queued"; error: string; code?: string };

/**
 * Execute a prompt injection.
 *
 * Local:  calls `injectFn` immediately (avoids importing child_process at module level
 *         so the route stays importable on the cloud host).
 * Remote: writes to pending_commands and returns the queued command ID.
 */
export async function executeInject(
  payload: InjectPayload & {
    /** Local project dir. When present on the remote path, we enqueue a
     *  `dispatch` command (ensure tab + launch agent if none + inject) instead
     *  of a bare `inject` — so the prompt lands even when no agent is running
     *  yet. Without a dir we can't launch, so fall back to `inject`. */
    dir?: string | null;
    /** Where the work may go instead when `channel`'s builder is offline right
     *  now (execution-access offlineFallbackChannel), and the directory that
     *  builder clones into. Null: the chosen builder is the only one. */
    offlineFallback?: { channel: RunnerChannel; dir: string | null } | null;
    /** When true (a busy local project), skip the direct inject and queue for
     *  the runner instead — so a 2nd same-project dispatch serializes behind the
     *  running agent rather than colliding in the shared tab/PTY/checkout. The
     *  runner claims it once the project frees (claimNextPendingCommand gates on
     *  the open run). */
    projectBusy?: boolean;
    /** What a busy project does with this dispatch: wait its turn (the
     *  default), or take a parallel lane when one is free. Only a caller whose
     *  work stands apart from the open run asks for a lane
     *  (orchestration/busy-placement.ts). */
    whenBusy?: WhenBusy;
    /** "fresh": a one-off session in a lane of its own, never the project's
     *  shared tab (orchestration/busy-placement.ts DispatchSession). */
    session?: DispatchSession;
    /** Local runtime with NO live owned PTY for this tab: there is nothing to
     *  type at, so queue (a dispatch cold-starts the agent) instead of calling
     *  injectFn. The queued row is visible in Control; a guessed terminal tab
     *  never is. */
    queueOnly?: boolean;
  },
  userId: string,
  injectFn: () => Promise<void>,
): Promise<ExecuteResult> {
  const runtimeAvailable = isRuntimeAvailable();
  // Direct injection requires a local runtime with a live owned PTY for the
  // tab. On the cloud host isRuntimeAvailable() is false, so remote always
  // queues for the runner. `projectBusy` forces the queue path locally too: a
  // 2nd same-project dispatch serializes behind the running agent instead of
  // colliding in the shared PTY. `queueOnly` is the no-live-PTY case.
  // A fresh session is never typed into the live shared PTY either.
  const fresh = payload.session === "fresh";
  if (runtimeAvailable && !payload.projectBusy && !payload.queueOnly && !fresh) {
    try {
      await injectFn();
      return { ok: true, mode: "direct" };
    } catch (err) {
      return { ok: false, mode: "direct", error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const remoteDefaultChannel = runtimeAvailable ? undefined : "cloud";
    const decision = await resolveQueuedExecution(userId, {
      requestedChannel: payload.channel,
      defaultChannel: remoteDefaultChannel,
      offlineFallback: payload.offlineFallback?.channel ?? null,
    });
    if (!decision.ok) {
      return { ok: false, mode: "queued", error: decision.message, code: decision.code };
    }
    const channel = decision.channel;
    // Rerouted work runs in the directory the fallback builder will clone
    // into, not the path the chosen builder had.
    const dir = decision.reroutedFrom ? (payload.offlineFallback?.dir ?? payload.dir) : payload.dir;
    // A busy project makes this dispatch wait for the run ahead of it: the
    // queued row keeps the project's own tab, and the runner claims it when
    // the project frees. A caller that asked for a lane (a person pressing
    // Implement and watching) gets its own tab and worktree instead and starts
    // now, when one is free. Only for a DISPATCH (it has a dir to put a
    // worktree in); a bare inject types into an existing session and has no
    // lane to fork.
    const placement = busyPlacement({
      projectBusy: payload.projectBusy,
      whenBusy: payload.whenBusy,
      hasDir: Boolean(payload.dir),
      hasProjectKey: Boolean(payload.projectKey),
      session: payload.session,
    });
    const plan =
      (placement === "lane" || placement === "fresh") && payload.dir && payload.projectKey
        ? await planParallelRun(
            userId,
            payload.runId,
            { projectKey: payload.projectKey, prompt: payload.prompt },
            placement === "fresh" ? { channel: channel ?? null } : undefined,
          )
        : null;
    // A fresh session that cannot have a lane of its own is refused. Falling
    // back to the queue would type the one-off into the shared session, which
    // is the thing it was asked not to do.
    if (placement === "fresh" && !plan) {
      return {
        ok: false,
        mode: "queued",
        code: "fresh-session-unavailable",
        error: freshSessionRefusal(payload),
      };
    }
    const commandId = dir
      ? await enqueueDispatchCommand(userId, {
          tab: plan?.tab ?? payload.tab,
          ...(channel ? { channel } : {}),
          dir,
          agent: payload.adapter ?? DEFAULT_ADAPTER_ID,
          prompt: plan?.prompt ?? payload.prompt,
          model: payload.model,
          promptKey: payload.promptKey,
          promptLabel: payload.promptLabel,
          projectKey: payload.projectKey,
          runId: payload.runId,
          // A fresh session resumes nothing.
          ...(plan && placement === "fresh" ? {} : { sessionId: payload.sessionId }),
          ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
        })
      : await enqueueInjectCommand(userId, channel ? { ...payload, channel } : payload);
    return {
      ok: true,
      mode: "queued",
      commandId,
      runnerConnected: decision.runnerConnected,
      ...(channel ? { channel } : {}),
      ...(decision.reroutedFrom ? { reroutedFrom: decision.reroutedFrom } : {}),
      ...(plan ? { parallelTab: plan.tab } : {}),
    };
  } catch (err) {
    return { ok: false, mode: "queued", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Why a fresh one-off session could not start, and that nothing was sent. */
function freshSessionRefusal(payload: {
  dir?: string | null;
  projectKey?: string;
  runId?: string;
}): string {
  const name = payload.projectKey ?? "this project";
  if (!payload.dir || !payload.projectKey) {
    return `A fresh session needs a checkout of ${name} to copy, and there is none. Nothing was sent to the project's own session.`;
  }
  if (!payload.runId) {
    return `A fresh session needs a tracked run, and this request has none. Nothing was sent to the project's own session.`;
  }
  return `${name} already has ${MAX_PARALLEL_LANES_PER_PROJECT} extra sessions open; a fresh one can start when one of them closes. Nothing was sent to the project's own session.`;
}
