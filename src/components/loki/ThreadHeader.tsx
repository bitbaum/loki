"use client";

import { useCallback, useState } from "react";
import {
  ArrowLeft,
  BookmarkPlus,
  FolderKanban,
  History,
  MoreVertical,
  MessageSquareWarning,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
} from "lucide-react";
import { ThreadTitle } from "./ThreadTitle";
import { projectTitle } from "@/lib/project-display";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";

/**
 * The thread's own header on a phone: back, what this conversation is, and a
 * menu — one line, like every texting app. Replaces the app top bar, the
 * bottom tabs and the old row of two icons while a conversation is open (see
 * useImmersiveChat). From md up the shell's chrome stays and this is hidden.
 */
export function ThreadHeader({
  title,
  projects,
  onBack,
  onOpenLokis,
  onNewChat,
  onOpenProjects,
  onSaveContext,
  onReportProblem,
  pinned = false,
  onTogglePin,
  onRename,
}: {
  title: string;
  projects: string[];
  onBack: () => void;
  onOpenLokis: () => void;
  onNewChat: () => void;
  onOpenProjects: () => void;
  /** Save the exchange into a project's context — an occasional act, so it
   *  lives here rather than as a line under every phone conversation. */
  onSaveContext?: () => void;
  onReportProblem?: () => void;
  /** A phone has no hover to reveal the rail's pin, so it lives here too. */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Rename the open thread — a person's name is kept, never re-derived. */
  onRename?: (title: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = useCallback(() => setMenuOpen(false), []);
  useEscapeToClose(close, !menuOpen);

  const first = projects[0] ? projectTitle({ name: projects[0] }) : null;
  const subtitle = !first
    ? "No project"
    : projects.length === 1
      ? first
      : `${first} and ${projects.length - 1} more`;

  const item = (label: string, Icon: typeof History, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="ui-menu-item ui-tap"
      onClick={() => {
        close();
        run();
      }}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );

  return (
    <header className="ui-loki-thread-header">
      <button
        type="button"
        className="ui-loki-topbar-btn"
        onClick={onBack}
        aria-label="Back to chats"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </button>
      {renaming && onRename ? (
        <div className="ui-loki-thread-header-title">
          <ThreadTitle title={title} onRename={onRename} editing onEditingChange={setRenaming} />
        </div>
      ) : (
        <button
          type="button"
          className="ui-loki-thread-header-title"
          onClick={onOpenProjects}
          title="Change project scope"
        >
          <span className="truncate text-base font-semibold text-text-primary">{title}</span>
          <span className="truncate text-xs text-text-tertiary">{subtitle}</span>
        </button>
      )}
      <div className="relative">
        <button
          type="button"
          className="ui-loki-topbar-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Conversation menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
        </button>
        {menuOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close menu"
              onClick={close}
            />
            <div className="ui-menu" role="menu">
              {item("New chat", SquarePen, onNewChat)}
              {item("All chats", History, onOpenLokis)}
              {item("Projects", FolderKanban, onOpenProjects)}
              {onReportProblem && item("Report a problem", MessageSquareWarning, onReportProblem)}
              {onSaveContext && item("Save to project context", BookmarkPlus, onSaveContext)}
              {onTogglePin &&
                item(pinned ? "Unpin" : "Pin to the top", pinned ? PinOff : Pin, onTogglePin)}
              {onRename && item("Rename", Pencil, () => setRenaming(true))}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

/**
 * The chat's own two controls outside a thread: reveal the chats (pin the rail
 * on a wide screen, open the drawer on a phone) and, on a phone, start a new
 * chat without opening the drawer first. One reveal control where a whole
 * duplicate toolbar used to sit.
 */
export function LokiTopbarButtons({
  pinned,
  onTogglePinned,
  onOpenLokis,
  onNewChat,
}: {
  pinned: boolean;
  onTogglePinned: () => void;
  onOpenLokis: () => void;
  onNewChat: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="ui-loki-topbar-btn"
        onClick={() =>
          window.matchMedia("(min-width: 768px)").matches ? onTogglePinned() : onOpenLokis()
        }
        aria-label={pinned ? "Hide chats" : "Show chats"}
        aria-pressed={pinned}
      >
        <PanelLeft className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        className="ui-loki-topbar-btn md:hidden"
        onClick={onNewChat}
        aria-label="New chat"
      >
        <SquarePen className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}
