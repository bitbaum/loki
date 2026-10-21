"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV } from "@/config/navigation";
import { openFeedback } from "@/lib/open-feedback";
import { MobileNavSheet } from "@/components/shell/MobileNavSheet";
import { TEMPORARY_CHAT_NOTE } from "@/lib/loki/temporary-chat";
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
 * Phones: the whole of /loki owns the screen (useImmersiveChat), so the app
 * top bar is gone and the page's own one-line header floats over the
 * conversation instead — WorkspaceThreadHeader in a thread (back, name, menu)
 * and WorkspaceStartHeader on the start screen (chats, Loki, menu). It used to
 * lend two buttons to the top bar's empty left half (TopbarPortal) outside a
 * thread; the bar that slot sat in no longer shows here. From md up: the
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
  /** On the start screen: the next chat is temporary. In a thread: this one is. */
  temporary: boolean;
  onToggleTemporary: () => void;
  onOpenProjects: () => void;
  onSaveContext: () => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
};

export function WorkspaceChrome({
  activeId,
  title,
  historyPinned,
  onToggleHistoryPinned,
  onOpenHistory,
  onNewChat,
  onRename,
}: ThreadChrome & {
  historyPinned: boolean;
  onToggleHistoryPinned: () => void;
}) {
  return (
    <div className="ui-loki-topbar max-md:hidden">
      <LokiTopbarButtons
        pinned={historyPinned}
        onTogglePinned={onToggleHistoryPinned}
        onOpenLokis={onOpenHistory}
        onNewChat={onNewChat}
      />
      {activeId && <ThreadTitle title={title} onRename={(t) => onRename(activeId, t)} />}
    </div>
  );
}

/**
 * The phone's start-screen header (chats · Loki · menu), floating over the
 * start screen like the thread's. With the bottom tabs gone from under the
 * composer, the menu is the way to the rest of the app: Home, and the sheet
 * of every other page the tabs' "More" used to open.
 */
export function WorkspaceStartHeader({
  projects,
  onOpenHistory,
  onNewChat,
  onOpenProjects,
  temporary,
  onToggleTemporary,
}: ThreadChrome) {
  const router = useRouter();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      <ThreadHeader
        leading="chats"
        title="Loki"
        subtitle={
          temporary
            ? TEMPORARY_CHAT_NOTE
            : projects.length === 0
              ? "Ask, or send work to a project"
              : undefined
        }
        projects={projects}
        onOpenLokis={onOpenHistory}
        onNewChat={onNewChat}
        onOpenProjects={onOpenProjects}
        temporary={temporary}
        onToggleTemporary={onToggleTemporary}
        onGoHome={() => router.push(NAV.control.href)}
        onOpenMore={() => setMoreOpen(true)}
        onReportProblem={() => openFeedback(() => router.push("/support"))}
      />
      {moreOpen && <MobileNavSheet pathname={pathname} onClose={() => setMoreOpen(false)} />}
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
  temporary,
}: ThreadChrome) {
  const router = useRouter();
  return (
    <ThreadHeader
      title={title}
      subtitle={temporary ? TEMPORARY_CHAT_NOTE : undefined}
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

/** The phone's floating header: the start screen's or the open thread's. */
export function WorkspacePhoneHeader({ start, ...chrome }: ThreadChrome & { start: boolean }) {
  return start ? <WorkspaceStartHeader {...chrome} /> : <WorkspaceThreadHeader {...chrome} />;
}
