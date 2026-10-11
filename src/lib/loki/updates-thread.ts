import { getOrCreateChannelConversation } from "@/db/queries/conversations";

/**
 * A project's progress channel: the thread Loki posts into when work it was
 * not asked for in chat moves — a fix started from the feedback inbox opens
 * its pull request, goes live, or fails to deploy.
 *
 * Work dispatched FROM a chat reports back into that chat
 * (payload.conversationId). Everything else used to report only to push,
 * Telegram and an alert, so the conversation surface — the one place a
 * person can see the whole story with pictures and ask a follow-up — never
 * heard about it. One thread per project, like a team channel, because the
 * owner reads updates per project, not per report.
 */
export function updatesChannel(projectKey: string): string {
  return `updates:${projectKey.toLowerCase()}`;
}

export async function projectUpdatesThreadId(userId: string, projectKey: string): Promise<string> {
  const thread = await getOrCreateChannelConversation(userId, updatesChannel(projectKey), {
    title: `${projectKey} · updates`,
    projectKeys: [projectKey],
  });
  return thread.id;
}
