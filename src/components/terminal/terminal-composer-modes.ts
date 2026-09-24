import type { ComposerMode } from "@/components/composer/composer-logic";

/** Where words written beside a terminal session can go. */
export type SessionComposerMode = "ask" | "inject";

/**
 * The modes a session composer offers, in display order.
 *
 * Ask needs a project to be about; without one it is dropped rather than shown
 * disabled. Inject is always offered — with no session attached it still
 * renders and says why it cannot send, because a mode that silently vanishes
 * reads as a missing feature, not a missing session.
 */
export function terminalComposerModes(
  requested: readonly SessionComposerMode[],
  { project, tab }: { project: string | null; tab: string | null },
): ComposerMode[] {
  const out: ComposerMode[] = [];
  for (const id of requested) {
    if (id === "ask" && project) {
      out.push({
        id,
        label: "Ask",
        hint: `A question about ${project} — nothing is sent to the session.`,
      });
    } else if (id === "inject") {
      out.push({
        id,
        label: "Inject",
        hint: tab
          ? `A task into ${tab}, with the project's context — queued if the builder is offline.`
          : "Open a session to inject into it.",
      });
    }
  }
  return out;
}
