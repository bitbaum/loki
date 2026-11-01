"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isFeedbackWidgetRoute } from "@/config/feedback-widget";
import { useFeedbackButton } from "@/hooks/use-feedback-button";
import {
  feedbackLauncherStatus,
  openFeedback,
  subscribeFeedbackStatus,
  type LauncherStatus,
} from "@/lib/open-feedback";
import { cn } from "@/lib/utils";
import { LokiMark } from "@/components/shell/LokiMark";

const NO_STATUS: LauncherStatus = { owner: false, watching: false, unread: 0 };

/**
 * Loki's own feedback widget, drawn in Loki's chrome — design reset rule 12.
 *
 * Every other site gets the widget's floating launcher. On Loki's own pages it
 * was an edge tab over the right edge of every page's content. Here the top
 * bar draws it instead: the same spiral, the owner's "watching" dot and the
 * count of what Loki said while the panel was closed, as one 40px round icon
 * like its neighbours. A tap opens the same panel (Watching mode, report,
 * ask) — `window.Loki.open()`.
 *
 * `data-fc-place="host"` on the button is the contract with the widget
 * (widget/placement.ts): while this button is on screen the widget draws no
 * launcher of its own, and counts the owner's status as shown. When the top
 * bar is hidden (an immersive phone page), the button is not rendered, the
 * directive goes with it, and the widget's own launcher comes back — so the
 * panel is never more than one tap away. Customer sites never render this.
 */
export function FeedbackLauncher({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { hidden } = useFeedbackButton();
  const status = useSyncExternalStore(
    subscribeFeedbackStatus,
    feedbackLauncherStatus,
    () => NO_STATUS,
  );

  // `enabled`: the server has a widget token (the same fact the root layout
  // uses to load /widget.js). `hidden`: the person switched the button off in
  // the account menu — this IS the button now, so it goes.
  if (!enabled || !isFeedbackWidgetRoute(pathname ?? "") || hidden === true) return null;

  const { owner, watching, unread } = status;
  const label = owner
    ? `Loki${watching ? " is watching this page" : " is paused"}${unread ? `, ${unread} new` : ""}`
    : "Feedback on this page";

  return (
    <button
      type="button"
      data-fc-place="host"
      onClick={() => openFeedback(() => router.push("/support"))}
      className="ui-topbar-btn"
      aria-label={label}
      title={label}
    >
      <LokiMark turns="tiny" className={cn("h-5 w-5", watching && "ui-topbar-spiral-watching")} />
      {/* The dot is the state; a count, when there is one, sits in the same
          corner and says more. */}
      {owner && unread === 0 && (
        <span
          className={cn("ui-topbar-btn-dot", watching ? "ui-dot-positive" : "ui-dot-neutral")}
          aria-hidden="true"
        />
      )}
      {unread > 0 && (
        <span className="ui-topbar-btn-count" aria-hidden="true">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
