"use client";

import { useCallback, useState } from "react";
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  Ghost,
  History,
  LayoutGrid,
  MoreVertical,
  MessageSquareWarning,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import { ThreadTitle } from "./ThreadTitle";
import { projectTitle } from "@/lib/project-display";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { TEMPORARY_CHAT_LABEL } from "@/lib/loki/temporary-chat";

/**
 * The chat's own header on a phone: one line, like every texting app, floating
 * over the conversation (ChatScreen). Replaces the app top bar, the bottom
 * tabs and the old row of two icons on the whole of /loki (see
 * useImmersiveChat). From md up the shell's chrome stays and this is hidden.
 *
 * Two shapes, one component. In a thread: back · the thread's name · menu.
 * On the start screen: chats · "Loki" · menu — the chat list is behind the
 * left pill, the way the ChatGPT and Claude apps keep history, and the menu
 * carries the way to the rest of the app (Home, every other page) now that
 * the bottom tabs no longer sit under the composer.
 */
export function ThreadHeader({
  title,
  subtitle: subtitleOverride,
  projects,
  leading = "back",
  onBack,
  onOpenLokis,
  onNewChat,
  places,
  onOpenMore,
  temporary = false,
  onToggleTemporary,
  onSaveContext,
  onReportProblem,
  pinned = false,
  onTogglePin,
  onRename,
}: {
  title: string;
  /** Under the name; by default the project scope. */
  subtitle?: string;
  projects: string[];
  /** The left pill: back out of a thread, or the chats behind the start screen. */
  leading?: "back" | "chats";
  onBack?: () => void;
  onOpenLokis: () => void;
  onNewChat: () => void;
  /**
   * The start screen's way to the rest of the app, by name. The app bars are
   * gone on a phone here, so this menu IS the navigation: it listed "Projects"
   * (which only set the chat's project) and "Everything else", and a person
   * looking for the terminal found neither word (owner, 2026-11-11).
   */
  places?: { label: string; icon: LucideIcon; go: () => void }[];
  onOpenMore?: () => void;
  /** The next chat (start screen) or this one (thread) is temporary:
   *  never listed, gone when the person leaves it (lib/loki/temporary-chat). */
  temporary?: boolean;
  onToggleTemporary?: () => void;
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
  const subtitle =
    subtitleOverride ??
    (!first
      ? "No project"
      : projects.length === 1
        ? first
        : `${first} and ${projects.length - 1} more`);
  const inThread = leading === "back";

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
      {inThread ? (
        <button
          type="button"
          className="ui-loki-topbar-btn"
          onClick={onBack}
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className="ui-loki-topbar-btn"
          onClick={onOpenLokis}
          aria-label="Show chats"
        >
          <PanelLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      {renaming && onRename ? (
        <div className="ui-loki-thread-header-title">
          <ThreadTitle title={title} onRename={onRename} editing onEditingChange={setRenaming} />
        </div>
      ) : (
        // A heading, not a button: the project is chosen in one place, the
        // composer's Project pill. The name used to open the same picker as
        // the menu and the pill, with no sign it could (owner audit, 2026-11-12).
        <div className="ui-loki-thread-header-title">
          <span className="truncate text-base font-semibold text-text-primary">{title}</span>
          <span className="truncate text-xs text-text-tertiary">{subtitle}</span>
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          className="ui-loki-topbar-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={inThread ? "Conversation menu" : "Loki menu"}
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
              {inThread && item("All chats", History, onOpenLokis)}
              {onToggleTemporary && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={temporary}
                  className="ui-menu-item ui-tap"
                  onClick={() => {
                    close();
                    onToggleTemporary();
                  }}
                >
                  <Ghost className="h-4 w-4" aria-hidden />
                  {TEMPORARY_CHAT_LABEL}
                  {temporary && <Check className="ml-auto h-4 w-4" aria-hidden />}
                </button>
              )}
              {places && places.length > 0 && <div className="ui-menu-separator" />}
              {places?.map((place) => item(place.label, place.icon, place.go))}
              {onOpenMore && item("All pages", LayoutGrid, onOpenMore)}
              {places && places.length > 0 && <div className="ui-menu-separator" />}
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
