/**
 * provisionAgentWorkspace — the SSOT for "launch an agent in a Loki-owned
 * PTY." Used by both /api/workspaces (the browser terminal) and /api/agent/launch
 * (Control's launch button on a self-hosted box). Builds the SAME login-interactive
 * shell + registry launch command the legacy zellij path used, so PATH/env/model
 * resolution is identical — only the substrate (an owned PTY vs a zellij pane) differs.
 *
 * Why this replaces zellij name-puppeting on the server: a zellij `action
 * go-to-tab-name` blocks forever on a detached session (a headless box has no
 * attached client), so launch timed out. Owning the PTY removes the dependency
 * on an attached human terminal entirely.
 */
import { executor } from "@/lib/agent-execution";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import type { AgentEvent, Unsubscribe, WorkspaceHandle } from "@/lib/agent-execution/types";
import { buildAgentOptionLaunchCommand, type AgentOption } from "@/lib/agent-registry";

export interface ProvisionAgentArgs {
  /** Project key — becomes the workspace id together with the user id. */
  projectKey: string;
  /** Working directory the agent runs in. */
  dir: string;
  /** A validated agent id (caller must have checked isAgentId / the registry). */
  agent: AgentOption;
  model?: string;
  sessionId?: string;
  /** Continue the folder's newest conversation (adapters that support it). */
  resumeLatest?: boolean;
  /** Extra environment for this run only — the repository token the box
   *  fetched for it, never anything from the runner's own environment. */
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /**
   * Explicit workspace id. Defaults to `workspaceIdFor(userId, projectKey)`.
   * The Fleet Runner passes its own (it has no server userId locally) so the
   * same helper provisions on both the server and the runner — same shell, same
   * launch command, only the id scheme differs.
   */
  workspaceId?: string;
}

/**
 * Provision (or re-attach to) a Loki-owned PTY running the given agent.
 * Idempotent per workspace id: a live workspace is returned, never respawned.
 */
export async function provisionAgentWorkspace(
  userId: string,
  args: ProvisionAgentArgs,
): Promise<WorkspaceHandle> {
  const launchCommand = buildAgentOptionLaunchCommand(
    {
      agent: args.agent,
      model: args.model,
      sessionId: args.sessionId,
      resumeLatest: args.resumeLatest,
    },
    args.dir,
  );
  // Login + interactive (-lic), NOT plain -c: the agent CLIs live on PATH only
  // after the profile/nvm chain loads (claude is in ~/.nvm/.../bin), and the
  // launch command's own `source ~/.bashrc` clobbers PATH non-interactively.
  // A login-interactive shell matches what a zellij pane gives the agent.
  return executor.provision({
    id: args.workspaceId ?? workspaceIdFor(userId, args.projectKey),
    cwd: args.dir,
    command: "bash",
    args: ["-lic", launchCommand],
    ...(args.env ? { env: args.env } : {}),
    cols: args.cols,
    rows: args.rows,
  });
}

/** Settle window after the agent first shows life before pasting — lets the CLI
 *  finish drawing its prompt so paste+enter is accepted instead of swallowed. */
const SETTLE_MS = 2000;

/**
 * Write an initial prompt into a freshly-provisioned agent PTY once the agent is
 * actually up — keyed off the first running/idle event rather than a blind timer
 * (the keystrokes would otherwise land in the boot banner). A max-wait fallback
 * guarantees a silent agent still receives it. Fire-and-forget.
 */
export function writeInitialPromptWhenReady(
  userId: string,
  projectKey: string,
  prompt: string,
  maxWaitMs = 15000,
): void {
  const id = workspaceIdFor(userId, projectKey);
  const text = prompt.endsWith("\r") ? prompt : `${prompt}\r`;
  let unsub: Unsubscribe = () => {};
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    try {
      executor.write(id, text);
    } catch {
      /* workspace gone — nothing to do */
    }
    unsub();
    clearTimeout(timer);
  };
  // subscribe replays buffered events synchronously; send is only ever invoked
  // via setTimeout, so `unsub`/`timer` are always assigned by the time it runs.
  unsub = executor.subscribe(id, 0, (e: AgentEvent) => {
    if (e.kind === "status" && (e.status === "running" || e.status === "idle")) {
      setTimeout(send, SETTLE_MS);
    }
  });
  const timer = setTimeout(send, maxWaitMs);
}
