import { ensureUserProjectEntityLinks } from "@/db/queries/user-projects";
import { listUnclaimedForChannel, retargetUnclaimedCommand } from "@/db/queries/pending-commands";
import type { DispatchPayload, InjectPayload } from "@/db/schema/pending-commands";
import {
  coldStartWorkspaceDir,
  getExecutionAccess,
  offlineFallbackChannel,
} from "@/lib/execution-access";
import { DEFAULT_ADAPTER_ID } from "@/lib/orchestration";

export type RerouteResult =
  | { ok: true; rerouted: number; skipped: { projectKey: string; reason: string }[] }
  | { ok: false; status: 403 | 409; error: string };

/**
 * Hand work that is waiting for this computer to the cloud builder — the
 * one-tap way out of a laptop that is shut.
 *
 * The routing rule (execution-access) decides where NEW work goes; this is
 * for rows that were queued before the laptop went away, or by a caller that
 * named the builder. It moves only what the same rule would allow: a project
 * with no locus lock and a cloneable repository, whose row nobody has claimed.
 * The project's stored preference is untouched — the next dispatch asks the
 * rule again, and the chat says where it went.
 *
 * An `inject` row (type into an existing session) becomes a `dispatch` (clone,
 * launch, prompt): the cloud has no session to type into, and a dispatch
 * always lands.
 */
export async function rerouteQueuedToCloud(
  userId: string,
  options: { commandId?: string | null } = {},
): Promise<RerouteResult> {
  const access = await getExecutionAccess(userId);
  if (!access.cloudBuilderAllowed) {
    return { ok: false, status: 403, error: "The cloud builder is private for this account." };
  }
  if (!access.presence.cloud) {
    return { ok: false, status: 409, error: "The cloud builder is offline too." };
  }
  const [rows, projects] = await Promise.all([
    listUnclaimedForChannel(userId, "local"),
    ensureUserProjectEntityLinks(userId).catch(() => []),
  ]);
  const wanted = options.commandId ? rows.filter((r) => r.id === options.commandId) : rows;
  let rerouted = 0;
  const skipped: { projectKey: string; reason: string }[] = [];
  for (const row of wanted) {
    const payload = row.payload as Partial<InjectPayload & DispatchPayload>;
    const key = payload.projectKey ?? payload.tab ?? "";
    const project =
      projects.find((p) => p.id === payload.projectId) ??
      projects.find((p) => p.name.toLowerCase() === key.toLowerCase());
    if (!project) {
      skipped.push({ projectKey: key, reason: "not one of your projects" });
      continue;
    }
    if (offlineFallbackChannel(project) !== "cloud") {
      skipped.push({ projectKey: key, reason: "only this computer has this project's files" });
      continue;
    }
    const dir = coldStartWorkspaceDir(project.name, project.gitUrl);
    if (!dir || !payload.prompt || !payload.tab) {
      skipped.push({ projectKey: key, reason: "nothing the cloud could run" });
      continue;
    }
    if (row.type !== "inject" && row.type !== "dispatch") {
      skipped.push({ projectKey: key, reason: "acts on a session on this computer" });
      continue;
    }
    const next: DispatchPayload = {
      tab: payload.tab,
      channel: "cloud",
      dir,
      agent: payload.agent ?? payload.adapter ?? DEFAULT_ADAPTER_ID,
      prompt: payload.prompt,
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.promptKey ? { promptKey: payload.promptKey } : {}),
      ...(payload.promptLabel ? { promptLabel: payload.promptLabel } : {}),
      ...(payload.projectKey ? { projectKey: payload.projectKey } : {}),
      ...(payload.runId ? { runId: payload.runId } : {}),
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    };
    const moved = await retargetUnclaimedCommand(userId, row.id, {
      type: "dispatch",
      payload: next as unknown as Record<string, unknown>,
    });
    if (moved) rerouted++;
    else skipped.push({ projectKey: key, reason: "a builder just picked it up" });
  }
  return { ok: true, rerouted, skipped };
}
