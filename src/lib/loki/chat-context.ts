/**
 * Project-aware Loki chat — SSOT for injecting Loki project profiles into
 * chat turns (same getProjectContext as dispatch, without sending work to the runner).
 */
import { USER_MESSAGE_MARKER } from "@/lib/loki/chat-scope";
import { getProjectContext } from "@/db/queries/project-context";
import { renderProjectContextBlock } from "@/lib/orchestration";
import type { CommandResolution } from "@/lib/command-resolve";
import { resolveProjectFromContext } from "@/lib/project-mention";

/** Which fleet project this chat turn is about — selection, resolver, or name in text. */
export function resolveLokiChatProjectKey(
  resolution: CommandResolution,
  selectedProjects: string[],
  projectNames: string[],
  text: string,
): string | null {
  if (resolution.projectKey) return resolution.projectKey;
  return resolveProjectFromContext(text, selectedProjects[0], projectNames);
}

/** Prepend the project brief + goals block when a project is in scope. */
export async function buildLokiChatPrompt(
  userId: string,
  userMessage: string,
  projectKey: string | null,
): Promise<string> {
  if (!projectKey) return userMessage;

  const ctx = await getProjectContext(userId, projectKey).catch(() => null);
  const block = renderProjectContextBlock(ctx ?? undefined);
  if (!block) return userMessage;

  return [`[Scoped to project: ${projectKey}]`, block, "", USER_MESSAGE_MARKER, userMessage].join(
    "\n",
  );
}
