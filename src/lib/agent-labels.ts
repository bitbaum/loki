// Leaf file with the agent ID list + label map. Intentionally has zero
// Node imports (no fs, no child_process, no path) so it can be safely
// imported from client components AND from the server-side registry.
//
// Why this exists separately from agent-registry.ts: that file imports
// fs/child_process for runner-side stuff (scanning processes, locating
// CLIs, etc.) which Turbopack will not bundle for a browser/edge
// context. control-presenter.ts is imported by ControlPanel ("use client"),
// so any client-reachable agent-label lookup must come from here, not
// from the heavier registry.

export const ALL_AGENT_IDS = ["codex", "claude", "gemini", "cursor", "grok", "openclaw"] as const;
export type AnyAgentId = (typeof ALL_AGENT_IDS)[number];

/** Display labels for every agent ID — the SINGLE source of truth. */
export const AGENT_LABELS: Record<AnyAgentId, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  // Kept as an internal adapter ID; the installed product is Antigravity.
  gemini: "Antigravity",
  grok: "Grok",
  openclaw: "OpenClaw",
};
