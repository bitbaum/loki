"use client";

// The "no forms" intake. Instead of clicking through mission/vision/customers
// field by field, the user writes (or dictates via OS dictation) what the
// project should be — or pulls the answer straight from the repo's README —
// and AI fills the profile. Both paths land in the same SSOT the inline
// editors write to, so a wrong guess is one click from fixable.

import { useState } from "react";
import { GitBranch, ListChecks, Loader2, Mic, Sparkles, Square } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { DOC_PASTE_MAX } from "@/lib/constants";
import { CharCount } from "@/components/ui/char-count";

type AppliedFields = Record<string, string>;

export function ProjectBriefFill({
  projectId,
  hasRepo,
  onReload,
}: {
  projectId: string;
  /** Whether a GitHub repo is linked (gates the "Fill from repo" button). */
  hasRepo: boolean;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"brief" | "enrich" | "roadmap" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[] | null>(null);
  const [createdGoals, setCreatedGoals] = useState<string[] | null>(null);
  const voice = useVoiceInput({
    // Speaking is the fastest "no forms" path — append so users can mix
    // dictation with typed/pasted notes before one AI fill pass.
    onTranscript: (t) => setText((prev) => (prev ? `${prev.trimEnd()} ${t}` : t)),
  });

  async function run(kind: "brief" | "enrich" | "roadmap") {
    setBusy(kind);
    setError(null);
    setAppliedKeys(null);
    setCreatedGoals(null);
    try {
      // brief + roadmap read the pasted text; enrich reads the repo README.
      const res = await postJson(
        `/api/projects/${projectId}/${kind}`,
        kind === "enrich" ? {} : { text },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        applied?: AppliedFields;
        created?: string[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      if (kind === "roadmap") setCreatedGoals(json.created ?? []);
      else setAppliedKeys(Object.keys(json.applied ?? {}));
      setText("");
      setOpen(false);
      onReload();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!open && (
          <button
            onClick={() => {
              setOpen(true);
              setAppliedKeys(null);
            }}
            className="ui-btn-chip ui-tap gap-1.5 px-3 text-xs"
            title="Write what this project is and should become, in your own words — AI fills mission, vision, customers, stack and next step for you."
          >
            <Sparkles className="h-3.5 w-3.5 text-accent-text" />
            Describe it — AI fills the profile
          </button>
        )}
        {hasRepo && (
          <button
            onClick={() => run("enrich")}
            disabled={busy !== null}
            className="ui-btn-chip ui-tap gap-1.5 px-3 text-xs"
            title="Read the repo's README (and CLAUDE.md) and fill the profile from it."
          >
            {busy === "enrich" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5 text-accent-text" />
            )}
            Fill from repo
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-raised p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            rows={4}
            placeholder="Free form — what is this project, who is it for, what should it become, what's next? Paste notes, dictate, anything. AI sorts it into the profile."
            className="ui-input w-full text-base leading-relaxed sm:text-xs"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <CharCount length={text.length} max={DOC_PASTE_MAX} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => run("brief")}
              disabled={
                busy !== null || text.trim().length < 10 || text.trim().length > DOC_PASTE_MAX
              }
              className="ui-btn-save ui-tap gap-1.5"
            >
              {busy === "brief" ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Fill profile
            </button>
            <button
              onClick={() => run("roadmap")}
              disabled={busy !== null || text.trim().length < 10}
              className="ui-btn-chip ui-tap gap-1.5 px-3 text-xs"
              title="Decompose the pasted spec into an ordered set of milestones, created as project goals."
            >
              {busy === "roadmap" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListChecks className="h-3.5 w-3.5 text-accent-text" />
              )}
              Generate milestones
            </button>
            {voice.isSupported && (
              <button
                onClick={() => (voice.status === "recording" ? voice.stop() : voice.start())}
                disabled={busy !== null || voice.status === "transcribing"}
                className="ui-btn-chip ui-tap gap-1.5 px-3 text-xs"
                title={
                  voice.status === "recording"
                    ? "Stop recording"
                    : "Dictate — speak what this project should be"
                }
              >
                {voice.status === "transcribing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : voice.status === "recording" ? (
                  <Square className="h-3.5 w-3.5 text-status-negative" />
                ) : (
                  <Mic className="h-3.5 w-3.5 text-accent-text" />
                )}
                {voice.status === "recording"
                  ? "Stop"
                  : voice.status === "transcribing"
                    ? "Transcribing…"
                    : "Speak"}
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
                voice.cancel();
              }}
              className="ui-btn-text-cancel ui-tap"
            >
              Cancel
            </button>
          </div>
          {voice.error && <p className="ui-error-xs">{voice.error}</p>}
        </div>
      )}

      {appliedKeys && appliedKeys.length > 0 && (
        <p className="text-xs text-status-positive">
          Filled: {appliedKeys.map((k) => k.replace(/_/g, " ")).join(", ")}. Click any field to
          adjust.
        </p>
      )}
      {createdGoals && createdGoals.length > 0 && (
        <p className="text-xs text-status-positive">
          Created {createdGoals.length} milestone{createdGoals.length === 1 ? "" : "s"} as goals —
          see the Goals tab.
        </p>
      )}
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}
