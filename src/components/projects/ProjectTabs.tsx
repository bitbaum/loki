"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * One project, one question at a time.
 *
 * Measured before this existed: the project page rendered 2,698 words across 17
 * sections in a single scroll. Ten of those sections answered variations of the
 * same question — Overview, Status quo, What happens next, Purpose, Product,
 * Reach, Build contract, Resources, Plan and finish line, Next action,
 * Completion contract. Three more carried 2,745 words between them.
 *
 * The cost was not ugliness, it was findability. Widget setup — the reason an
 * operator opens this page when a site needs the embed — sat behind an
 * unlabelled toggle below a thousand words of feedback items. A person looked
 * for it, did not find it, and concluded the feature did not exist. It did.
 *
 * A jump-nav already existed and indexed 6 of the 17 sections, which its own
 * comment correctly identified as the worst option: a nav that knows about some
 * sections teaches the reader the others are not there.
 *
 * So: tabs, not anchors. An anchor scrolls you into a wall and leaves the other
 * 2,400 words below you; a tab removes them. The default tab answers "what is
 * this and what do I do", and everything else is one deliberate click away.
 *
 * Counts on the tab labels do the work the wall of text was failing to do —
 * "Feedback 3" tells you where to go without you reading anything first.
 */

export interface ProjectTab {
  id: string;
  label: string;
  /** Rendered as a badge. Omit or 0 for none — a "0" badge is noise that
   *  teaches the eye to ignore all badges, including the ones that matter. */
  count?: number;
  /** Draws the count in the attention colour. For things genuinely waiting on
   *  a human, never for a neutral total like "12 runs". */
  urgent?: boolean;
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
      if (id && tabs.some((t) => t.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  const select = (id: string) => {
    setActive(id);
    // A tab picked near the clipped edge scrolls fully into view.
    document
      .getElementById(`tab-${id}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
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
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    select(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label="Project sections" className="ui-tabbar">
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
            className={cn(
              "ui-tap inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3",
              active === tab.id
                ? "bg-surface-raised text-text-primary"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
            )}
          >
            {tab.label}
            {!!tab.count && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-micro font-semibold tabular-nums",
                  tab.urgent
                    ? "bg-status-negative-subtle text-status-negative"
                    : "bg-surface-overlay text-text-secondary",
                )}
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
          `scroll-mt-28` clears the sticky tab bar. */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={tab.id}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
          className="scroll-mt-28 space-y-6"
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
