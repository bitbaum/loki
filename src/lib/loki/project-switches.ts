/**
 * Where one chat moves from one project to another.
 *
 * A Loki conversation is not tied to a project — name another one and the
 * next answer works there (resolveDispatchTargets), and the scope follows.
 * That switch used to be silent: only the small label in the thread header
 * changed, so a long chat that went loki → orangecat → loki read as one
 * undifferentiated scroll. The thread now draws a quiet "Now on X" rule at
 * each switch — above the message that asked, so the request and its answer
 * sit together under their project. Pure; tested in scripts/test/project-switches.ts.
 */
type Turn = { role: string; meta?: Record<string, unknown> | null };

/** The one project an answer worked on, if it names exactly one. */
export function turnProject(meta: Record<string, unknown> | null | undefined): string | null {
  if (typeof meta?.projectKey === "string" && meta.projectKey.trim()) return meta.projectKey;
  const keys = Array.isArray(meta?.projectKeys)
    ? meta.projectKeys.filter((k): k is string => typeof k === "string" && !!k.trim())
    : [];
  return keys.length === 1 ? keys[0] : null;
}

/**
 * Index of the message to draw the rule above → the project it switches to.
 * The first project in a chat is not a switch (the header already says it);
 * an answer that names no project changes nothing.
 */
export function projectSwitches(messages: readonly Turn[]): Map<number, string> {
  const out = new Map<number, string>();
  let current: string | null = null;
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const p = turnProject(m.meta);
    if (!p) return;
    if (current && p.toLowerCase() !== current.toLowerCase()) {
      // Above the question that led here, when it is right before the answer.
      const at = i > 0 && messages[i - 1].role === "user" ? i - 1 : i;
      out.set(at, p);
    }
    current = p;
  });
  return out;
}
