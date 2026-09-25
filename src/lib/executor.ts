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
import type { InjectPayload } from "@/db/schema/pending-commands";
import { resolveQueuedExecution } from "@/lib/execution-access";
import { planParallelRun } from "@/lib/orchestration/parallel-run";

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
    /** When true (a busy local project), skip the direct inject and queue for
     *  the runner instead — so a 2nd same-project dispatch serializes behind the
     *  running agent rather than colliding in the shared tab/PTY/checkout. The
     *  runner claims it once the project frees (claimNextPendingCommand gates on
     *  the open run). */
    projectBusy?: boolean;
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
  if (runtimeAvailable && !payload.projectBusy && !payload.queueOnly) {
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
    });
    if (!decision.ok) {
      return { ok: false, mode: "queued", error: decision.message, code: decision.code };
    }
    const channel = decision.channel;
    // A busy project would make this dispatch wait for the run ahead of it.
    // When a parallel lane is free, it gets its own tab and worktree instead
    // and starts now — the case that matters is a person pressing Implement
    // and watching. Only for a DISPATCH (it has a dir to put a worktree in);
    // a bare inject types into an existing session and has no lane to fork.
    const plan =
      payload.projectBusy && payload.dir && payload.projectKey
        ? await planParallelRun(userId, payload.runId, {
            projectKey: payload.projectKey,
            prompt: payload.prompt,
          })
        : null;
    const commandId = payload.dir
      ? await enqueueDispatchCommand(userId, {
          tab: plan?.tab ?? payload.tab,
          ...(channel ? { channel } : {}),
          dir: payload.dir,
          agent: payload.adapter ?? DEFAULT_ADAPTER_ID,
          prompt: plan?.prompt ?? payload.prompt,
          model: payload.model,
          promptKey: payload.promptKey,
          promptLabel: payload.promptLabel,
          projectKey: payload.projectKey,
          runId: payload.runId,
          sessionId: payload.sessionId,
        })
      : await enqueueInjectCommand(userId, channel ? { ...payload, channel } : payload);
    return {
      ok: true,
      mode: "queued",
      commandId,
      runnerConnected: decision.runnerConnected,
      ...(plan ? { parallelTab: plan.tab } : {}),
    };
  } catch (err) {
    return { ok: false, mode: "queued", error: err instanceof Error ? err.message : String(err) };
  }
}
