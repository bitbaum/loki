"use client";

import { useState } from "react";
import { ChevronDown, FolderGit2, X } from "lucide-react";
import { Composer } from "@/components/composer/Composer";
import { Modal } from "@/components/ui/modal";
import type { Attachment } from "@/components/loki/types";
import { OptionRow } from "@/components/terminal/sheet-rows";
import { useFleetProject } from "@/hooks/use-fleet-project";
import { rememberFleetProject } from "@/lib/fleet-context";
import type { InjectResult } from "@/hooks/use-control-actions";

export type HomeProject = { tab: string; detail?: string };

/**
 * The top of Home: say what to build, in which project. Codex and ChatGPT
 * open on the box; so does this.
 *
 * It replaced a "Nothing is being built right now" card whose one button,
 * "Start something", left the page for /loki, and a second message box
 * inside whichever project card happened to be open further down — two
 * different places to ask for work on the same screen (owner, 2026-10-19).
 * The project is a chip in the box: the one you were last in, one tap to
 * change. What you send goes to that project's agent, exactly as the card's
 * box did (/api/inject), and appears under "Being built now".
 */
export function HomeComposer({
  projects,
  onSend,
}: {
  /** Every project this person can build in, in the order the list shows. */
  projects: HomeProject[];
  onSend: (tab: string, text: string, attachments: Attachment[]) => Promise<InjectResult>;
}) {
  const remembered = useFleetProject();
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const known = (tab: string | null) =>
    tab ? (projects.find((p) => p.tab.toLowerCase() === tab.toLowerCase())?.tab ?? null) : null;
  const project = known(chosen) ?? known(remembered) ?? projects[0]?.tab ?? null;
  if (!project) return null;

  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    setSaid(null);
    try {
      const result = await onSend(project, text, attachments);
      setSaid(
        result.mode === "queued" && result.runnerConnected === false
          ? `Saved for ${project}. It starts when the builder is back.`
          : `Sent to ${project}. It shows under "Being built now" in a moment.`,
      );
      return true;
    } catch (e) {
      setSaid(e instanceof Error ? e.message : "Not sent. Your words are still in the box.");
      return false;
    }
  };

  return (
    <div className="ui-home-box">
      <Composer
        placeholder="What should we build?"
        ariaLabel={`What should ${project} build next`}
        onSend={(text, _choice, attachments) => send(text, attachments)}
        attachmentOnlyText="Look at the attached screenshot and fix what is wrong."
        tools={
          <button
            type="button"
            className="ui-box-chip"
            onClick={() => setPicking(true)}
            aria-haspopup="dialog"
            aria-label={`Project: ${project}. Change the project`}
          >
            <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{project}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>
        }
        footer={
          said ? (
            <div className="ui-loki-composer-status" role="status">
              <span className="min-w-0 flex-1">{said}</span>
              <button
                type="button"
                onClick={() => setSaid(null)}
                aria-label="Dismiss"
                className="ui-icon-action shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null
        }
      />
      {picking && (
        <Modal
          onClose={() => setPicking(false)}
          position="bottom-mobile"
          padded={false}
          size="md"
          className="ui-sheet"
          labelledBy="home-project-title"
        >
          <div className="ui-sheet-grip" aria-hidden="true" />
          <div className="ui-sheet-body">
            <h2 id="home-project-title" className="ui-sheet-label">
              Build in
            </h2>
            {projects.map((p) => (
              <OptionRow
                key={p.tab}
                title={p.tab}
                detail={p.detail}
                active={p.tab === project}
                onSelect={() => {
                  setChosen(p.tab);
                  rememberFleetProject(p.tab);
                  setPicking(false);
                }}
              />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
