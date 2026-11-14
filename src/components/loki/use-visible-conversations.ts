"use client";

import { useMemo } from "react";
import { deleteJson, throwApiError } from "@/lib/api/fetch";

/** Client-side project filter over the full list (deselect = show all). */
export function useVisibleConversations<T extends { id: string; projectKeys: string[] }>(
  conversations: T[],
  selectedProjects: string[],
  activeId: string | null,
): T[] {
  return useMemo(() => {
    if (selectedProjects.length === 0) return conversations;
    const wanted = new Set(selectedProjects);
    // The thread you are IN is never filtered out of the rail.
    //
    // Scope follows the answer — a turn that resolves to a project selects it —
    // so asking a question in a fresh thread could set a scope the thread
    // itself does not carry yet, and the row for the conversation on screen
    // vanished from the list while you were reading it. A filter may narrow
    // what else is offered; it may not hide where you are.
    return conversations.filter(
      (c) => c.id === activeId || c.projectKeys.some((k) => wanted.has(k)),
    );
  }, [conversations, selectedProjects, activeId]);
}

/** Delete a conversation; when it is the open one, the caller clears the screen. */
export function useDeleteConversation<T extends { id: string }>(input: {
  activeId: string | null;
  setError: (message: string | null) => void;
  setConversations: (update: (prev: T[]) => T[]) => void;
  onActiveDeleted: () => void;
}) {
  return async (id: string) => {
    input.setError(null);
    const res = await deleteJson(`/api/conversations/${id}`);
    if (!res.ok) {
      await throwApiError(res, "Could not delete conversation.").catch((e: Error) =>
        input.setError(e.message),
      );
      return;
    }
    input.setConversations((prev) => prev.filter((c) => c.id !== id));
    if (input.activeId === id) input.onActiveDeleted();
  };
}
