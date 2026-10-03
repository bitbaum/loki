"use client";

import { Check, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { MarkdownText } from "@/components/ui/markdown-text";
import { toolLabel } from "@/config/loki-tool-labels";
import { groupWork, summarizeTools, type WorkStep, type WorkTool } from "@/lib/loki/work";

/**
 * What Loki actually did to answer — said and run, in order.
 *
 * This is the part the old surface threw away twice. `runLokiTurn` has always
 * returned `toolsUsed`, carrying the comment "surfaced so the UI can show
 * work", and no caller ever surfaced it: a turn that searched your people,
 * read your projects and queried the knowledge graph rendered as one static
 * "Loki is thinking" line for as long as it took. And what the model SAID in a
 * gathering round — "Found it, checking who owns them" — was discarded at the
 * next round's reset, so the operator never read the thinking at all.
 *
 * The rhythm is the one the operator already reads all day in the Claude Code
 * app: a sentence, a collapsed group of commands with a chevron, a sentence,
 * the answer. Live, the current group is open and its running step spins. Once
 * the answer lands every group collapses to one line — by then the answer is
 * the thing being read and the work is provenance you open when you doubt it.
 * The same component renders a live turn and a reopened one, from the same
 * list, so nothing changes between watching it and coming back to it.
 */
export function WorkTrail({
  work,
  /** True while the turn is still running — keeps the last group open. */
  live,
}: {
  work: WorkStep[];
  live: boolean;
}) {
  const segments = groupWork(work);
  if (segments.length === 0) return null;
  const lastIndex = segments.length - 1;
  return (
    <div className="ui-loki-trail">
      {segments.map((segment, i) =>
        segment.kind === "note" ? (
          <div key={`note-${i}`} className="ui-loki-trail-note">
            <MarkdownText text={segment.text} className="space-y-2" />
          </div>
        ) : (
          <ToolGroup key={`tools-${i}`} tools={segment.tools} live={live && i === lastIndex} />
        ),
      )}
    </div>
  );
}

function ToolGroup({ tools, live }: { tools: WorkTool[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  // A running group shows its work; a finished one offers it.
  const expanded = live || open;
  const running = tools.find((t) => t.phase === "start");
  const summary =
    live && running ? (toolLabel(running.name, "start") ?? "Working") : summarizeTools(tools);

  return (
    <div className="ui-loki-trail-group">
      <button
        type="button"
        className="ui-loki-trail-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        // While live the group is not a disclosure — it is the status line.
        disabled={live}
      >
        {live && running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <ChevronRight
            className={
              expanded ? "ui-loki-trail-caret ui-loki-trail-caret-open" : "ui-loki-trail-caret"
            }
            aria-hidden
          />
        )}
        <span className="truncate">{summary}</span>
      </button>

      {expanded && (
        <ul className="ui-loki-trail-list">
          {tools.map((tool, i) => (
            <li key={`${tool.name}-${i}`} className="ui-loki-trail-step">
              {tool.phase === "start" ? (
                <Loader2 className="ui-loki-trail-icon animate-spin" aria-hidden />
              ) : tool.phase === "fail" ? (
                <TriangleAlert className="ui-loki-trail-icon text-status-warning" aria-hidden />
              ) : (
                <Check className="ui-loki-trail-icon text-status-positive" aria-hidden />
              )}
              <span className="truncate">{toolLabel(tool.name, tool.phase)}</span>
              {tool.phase === "end" && (
                <span className="ui-loki-trail-count">
                  {tool.facts ?? 0} {(tool.facts ?? 0) === 1 ? "record" : "records"}
                </span>
              )}
              {/* A failed tool is not an empty result. Saying "nothing found"
                  here would teach the operator their data is empty when in
                  fact the lookup never completed. */}
              {tool.phase === "fail" && <span className="ui-loki-trail-count">unavailable</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
