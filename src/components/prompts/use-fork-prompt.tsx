"use client";

import { useState } from "react";
import { postJson } from "@/lib/api/fetch";
import type { PromptTemplate } from "@/config/prompt-library";
import { TOAST_MEDIUM_MS } from "@/lib/constants/timings";

export type ForkState = "idle" | "forking" | "done" | "exists" | "error";

/**
 * Fork a Loki default into a user-owned copy. The default's body becomes
 * the editable body of a new `fc-default-fork` row, tracked back to its origin
 * via `forkedFromKey`. This is the missing control behind the "fork a default"
 * copy in UserPromptsSection — the DB already supported it.
 *
 * Project-scoped defaults can't be forked to a global row without a project
 * (createPrompt rejects scope='project' without projectId), so a forked copy
 * is always created as global — the user can re-pin it via Edit afterwards.
 */
export function useForkPrompt(template: PromptTemplate, onForked: () => void) {
  const [state, setState] = useState<ForkState>("idle");

  async function fork() {
    if (state === "forking") return;
    setState("forking");
    try {
      const res = await postJson("/api/prompts", {
        name: template.name,
        description: template.description || null,
        body: template.template,
        scope: "global",
        tags: template.tags ?? [],
        source: "fc-default-fork",
        forkedFromKey: template.id,
      });
      if (!res.ok) {
        setState("error");
        setTimeout(() => setState("idle"), TOAST_MEDIUM_MS);
        return;
      }
      // The same name + words already saved: the API hands back that prompt
      // instead of a second row, and the card says so.
      const data = (await res.json().catch(() => ({}))) as { existing?: boolean };
      setState(data.existing ? "exists" : "done");
      onForked();
      setTimeout(() => setState("idle"), TOAST_MEDIUM_MS);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), TOAST_MEDIUM_MS);
    }
  }

  return { fork, state };
}
