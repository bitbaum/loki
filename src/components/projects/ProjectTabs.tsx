"use client";

import { useEffect, useState } from "react";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { cn } from "@/lib/utils";
import { trackUsage } from "@/lib/usage/track";

/** One section model drives desktop tabs, the phone selector, and existing deep links. */
export interface ProjectTab {
  id: string;
  label: string;
  /** Rendered as a badge. Omit or 0 for none — a "0" badge is noise that
   *  teaches the eye to ignore all badges, including the ones that matter. */
  count?: number;
  /** Draws the count in the attention colour. For things genuinely waiting on
   *  a human, never for a neutral total like "12 runs". */
  urgent?: boolean;
  /** Places inside this tab a link may name (`#ask`): the tab opens and the
   *  place scrolls into view, from any other tab. */
  anchors?: string[];
  content: React.ReactNode;
}

export function ProjectTabs({ tabs, initialId }: { tabs: ProjectTab[]; initialId?: string }) {
  const [active, setActive] = useState(initialId ?? tabs[0]?.id ?? "");

  // Deep links must survive the move from anchors to tabs. ControlInbox links
  // to /projects/<id>#feedback, and half the copy in this app points at
  // #settings — those were section anchors, so without this they would scroll
  // to nothing and look broken. Reading the hash keeps every existing link
  // working and makes tabs linkable in their own right.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (!id) return;
      if (tabs.some((t) => t.id === id)) return setActive(id);
      const holder = tabs.find((t) => t.anchors?.includes(id));
      if (!holder) return;
      setActive(holder.id);
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  const select = (id: string) => {
    setActive(id);
    trackUsage({ surface: "projects.workspace", action: "tap", target: id });
    // replaceState, not a hash assignment: setting location.hash would scroll
    // the viewport to an element that no longer exists as an anchor, and would
    // stack a history entry per tab click so Back walks tabs instead of leaving.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  /** Arrow keys move between tabs — expected of a tablist, and the only way to
   *  reach them without a pointer. */
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : e.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;
    select(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  return (
    <>
      {/* Seven sections do not fit a phone as tabs, and a cut row of them
          is what rule 7 forbids: on a phone the section is ONE button naming
          where you are, which opens the rest as a sheet. It was a boxed
          native select pinned under the top bar (design reset, 2026-10-21).
          Nothing here sticks — the page scrolls as one. */}
      <div className="ui-project-mobile-sections">
        <ChoiceMenu
          bare
          align="start"
          label="Project section"
          value={active}
          options={tabs.map((tab) => ({
            value: tab.id,
            label: tab.count ? `${tab.label} (${tab.count})` : tab.label,
          }))}
          onChange={select}
        />
      </div>
      <div role="tablist" aria-label="Project sections" className="ui-project-tabs">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={active === tab.id}
            aria-controls={tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn("ui-project-tab", active === tab.id && "ui-project-tab-active")}
          >
            {tab.label}
            {!!tab.count && (
              <span
                className={cn("ui-project-tab-count", tab.urgent && "ui-project-tab-count-urgent")}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* The panel owns the hash id, and the sections inside it no longer carry
          one. Before this, both existed: the panel was `panel-feedback` while
          the section inside kept the legacy `id="feedback"` from when these
          were scroll anchors. Every panel stays mounted, so loading
          /projects/<id>#feedback gave the browser a real element to scroll to
          that was inside a HIDDEN panel — native anchor behaviour racing the
          tab logic over the same name. One element per anchor removes the race,
          and what the browser scrolls to is now what becomes visible.
          Nothing sticks above it any more, so no scroll margin is needed. */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={tab.id}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
          className="space-y-6"
        >
          {/* Mounted even while hidden, on purpose. These panels contain forms
              with unsaved drafts and lists that poll while work is in flight;
              unmounting would discard a half-typed brief the moment someone
              checked another tab. `hidden` keeps them out of the accessibility
              tree and out of the way. */}
          {tab.content}
        </div>
      ))}
    </>
  );
}
