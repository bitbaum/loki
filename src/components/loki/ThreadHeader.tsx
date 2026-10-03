"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, FolderKanban, History, MoreVertical, SquarePen } from "lucide-react";
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
  onOpenChats,
  onNewChat,
  onOpenProjects,
}: {
  title: string;
  projects: string[];
  onBack: () => void;
  onOpenChats: () => void;
  onNewChat: () => void;
  onOpenProjects: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = useCallback(() => setMenuOpen(false), []);
  useEscapeToClose(close, !menuOpen);

  const subtitle =
    projects.length === 0
      ? "No project — answers only"
      : projects.length === 1
        ? projects[0]
        : `${projects[0]} +${projects.length - 1} more`;

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
      <button
        type="button"
        className="ui-loki-thread-header-title"
        onClick={onOpenProjects}
        title="Change project scope"
      >
        <span className="truncate text-base font-semibold text-text-primary">{title}</span>
        <span className="truncate text-xs text-text-tertiary">{subtitle}</span>
      </button>
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
              {item("All chats", History, onOpenChats)}
              {item("Projects", FolderKanban, onOpenProjects)}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
