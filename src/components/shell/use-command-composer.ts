"use client";

import { useCallback, useState } from "react";

/**
 * The palette's natural-language composer.
 *
 * Two hops: /api/command/resolve turns free text into { project, prompt }, then
 * /api/inject dispatches it into that project's existing agent session (the
 * operator's call — dispatch goes to the running session, never a new one).
 *
 * When the resolver cannot name a project it says so instead of guessing, and
 * the palette switches to a project picker ("ask when ambiguous"). `pending`
 * holds the resolved prompt while that choice is outstanding.
 */
export function useCommandComposer(deps: {
  projectNames: string[];
  onDispatched: () => void;
  onNeedsProject: () => void;
}) {
  const { projectNames, onDispatched, onNeedsProject } = deps;
  // busy = resolving/dispatching; pending = a command whose project we still
  // need to ask for; note = inline status/error.
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ prompt: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPending(null);
    setNote(null);
    setBusy(false);
  }, []);

  /** Back out of the project picker, leaving the palette open. */
  const cancelPending = useCallback(() => {
    setPending(null);
    setNote(null);
  }, []);

  const dispatchInject = useCallback(
    async (projectKey: string, prompt: string) => {
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch("/api/inject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tab: projectKey, customPrompt: prompt }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          setNote(b.error ?? `Dispatch failed (HTTP ${res.status})`);
          return;
        }
        setPending(null);
        onDispatched();
      } catch {
        setNote("Dispatch failed — check the runner is connected.");
      } finally {
        setBusy(false);
      }
    },
    [onDispatched],
  );

  const resolveAndRun = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch("/api/command/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, projects: projectNames }),
        });
        const r = (await res.json().catch(() => ({}))) as {
          projectKey?: string | null;
          prompt?: string;
          needsProject?: boolean;
          error?: string;
        };
        if (!res.ok) {
          setNote(r.error ?? "Couldn't understand that command.");
          return;
        }
        const prompt = r.prompt?.trim() || text.trim();
        if (r.needsProject || !r.projectKey) {
          setPending({ prompt });
          onNeedsProject();
          return;
        }
        await dispatchInject(r.projectKey, prompt);
      } catch {
        setNote("Couldn't reach the resolver.");
      } finally {
        setBusy(false);
      }
    },
    [projectNames, dispatchInject, onNeedsProject],
  );

  return { busy, pending, note, reset, cancelPending, dispatchInject, resolveAndRun };
}
