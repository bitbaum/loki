/**
 * Which agent a terminal tab is ACTUALLY running.
 *
 * The switcher, the Claude | Terminal toggle and the chat view all keyed off
 * the project's saved PREFERENCE (`agentPref`). A project that prefers Claude
 * but has Cursor running in its tab therefore labelled the switcher "Claude",
 * offered a Chat view that Cursor never writes a transcript for, and treated a
 * pick of Claude as "already active" — a no-op. The operator's report was "I
 * can't switch from Cursor to Claude with that dropdown".
 *
 * The runner reports the live CLI per pane; that is the truth. Preference only
 * answers when nothing is running (or the CLI is one the roster doesn't list).
 */
export function activeAgentFor({
  liveAgents,
  rosterIds,
  pref,
  fallback,
}: {
  liveAgents: readonly string[];
  rosterIds: readonly string[];
  pref: string | null | undefined;
  fallback: string | null | undefined;
}): string | null {
  const live = liveAgents.find((id) => rosterIds.includes(id));
  return live ?? pref ?? fallback ?? null;
}

/** Per-builder display names for tabs, keyed by the tab's real id. A name is
 *  only a label — the id the runner knows the session by never changes. */
export type TabAliases = Record<string, string>;

export function parseTabAliases(raw: string): TabAliases {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

/** Set or (with an empty/unchanged name) clear one alias, returning a new map. */
export function withTabAlias(
  aliases: TabAliases,
  tab: string,
  name: string,
  original: string,
): TabAliases {
  const next = { ...aliases };
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || trimmed === original) delete next[tab];
  else next[tab] = trimmed;
  return next;
}
