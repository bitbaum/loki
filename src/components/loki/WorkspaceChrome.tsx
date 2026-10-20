"use client";

import { useRouter } from "next/navigation";
import { openFeedback } from "@/lib/open-feedback";
import { TopbarPortal } from "@/components/shell/TopbarSlot";
import { LokiTopbarButtons, ThreadHeader } from "./ThreadHeader";
import { ThreadTitle } from "./ThreadTitle";

/**
 * The chat's chrome above the transcript, for both widths.
 *
 * ONE control, not four. This used to be a "Chats" button and a "New" button
 * sitting above the transcript, duplicating the rail that was already on
 * screen and the global sidebar above that. The rail itself owns "new chat"
 * now, so what is left is the only thing the rail cannot do: reveal itself.
 *
 * Phones: in a thread, the thread's own one-line header (back, name, menu);
 * outside one, the same two buttons live in the app top bar's empty left half
 * (TopbarPortal) instead of a second header row under it. From md up: the
 * reveal button, and the open thread's name, which is where it is renamed.
 *
 * Lifted out of LokiWorkspace, which is at its line cap.
 */
/** The open thread's controls, shared by the desktop bar and the phone header. */
export type ThreadChrome = {
  activeId: string | null;
  title: string;
  projects: string[];
  pinned: boolean;
  canSaveContext: boolean;
  onOpenHistory: () => void;
  onNewChat: () => void;
  /** Back to the chats — the start page without "New chat"'s fresh box. */
  onLeaveThread: () => void;
  onOpenProjects: () => void;
  onSaveContext: () => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
};

export function WorkspaceChrome({
  inThread,
  activeId,
  title,
  historyPinned,
  onToggleHistoryPinned,
  onOpenHistory,
  onNewChat,
  onRename,
}: ThreadChrome & {
  inThread: boolean;
  historyPinned: boolean;
  onToggleHistoryPinned: () => void;
}) {
  const buttons = (
    <LokiTopbarButtons
      pinned={historyPinned}
      onTogglePinned={onToggleHistoryPinned}
      onOpenLokis={onOpenHistory}
      onNewChat={onNewChat}
    />
  );
  return (
    <>
      {!inThread && <TopbarPortal>{buttons}</TopbarPortal>}
      <div className="ui-loki-topbar max-md:hidden">
        {buttons}
        {inThread && activeId && (
          <ThreadTitle title={title} onRename={(t) => onRename(activeId, t)} />
        )}
      </div>
    </>
  );
}

/**
 * The phone's one-line thread header (back · name · menu). Rendered by the
 * workspace into ChatScreen's header, where it floats over the conversation.
 */
export function WorkspaceThreadHeader({
  activeId,
  title,
  projects,
  pinned,
  canSaveContext,
  onOpenHistory,
  onNewChat,
  onLeaveThread,
  onOpenProjects,
  onSaveContext,
  onTogglePin,
  onRename,
}: ThreadChrome) {
  const router = useRouter();
  return (
    <ThreadHeader
      title={title}
      projects={projects}
      onBack={onLeaveThread}
      onOpenLokis={onOpenHistory}
      onNewChat={onNewChat}
      onOpenProjects={onOpenProjects}
      onSaveContext={canSaveContext ? onSaveContext : undefined}
      onReportProblem={() => openFeedback(() => router.push("/support"))}
      pinned={pinned}
      onTogglePin={activeId ? () => onTogglePin(activeId, !pinned) : undefined}
      onRename={activeId ? (t) => onRename(activeId, t) : undefined}
    />
  );
}
