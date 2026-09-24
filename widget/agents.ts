/**
 * The agents a visitor can talk to from the widget's Chat mode.
 *
 * One conversation surface, two agents — the same split as the fleet itself:
 *   loki — the execution plane: what should change on this site, and it can
 *          hand the conversation to Loki Implement as a build brief.
 *   cat  — OrangeCat's economic agent: funding, paying, offering, getting paid.
 *
 * DOM-free so the Node tests can read it. The server holds the matching
 * personas in src/config/widget-agents.ts; scripts/test/widget-agents.ts fails
 * if the two id lists drift.
 */
export const WIDGET_AGENT_IDS = ["loki", "cat"] as const;
export type WidgetAgentId = (typeof WIDGET_AGENT_IDS)[number];

export type WidgetAgentMeta = {
  label: string;
  /** One line under the name in the agent picker. */
  role: string;
  /** The empty-state headline. */
  greeting: string;
  placeholder: string;
  /** Tap-to-send starters, so nobody faces an empty box. */
  starters: readonly string[];
  /** Whether the conversation can be handed to Loki Implement as a brief. */
  canBuild: boolean;
};

export const WIDGET_AGENTS: Record<WidgetAgentId, WidgetAgentMeta> = {
  loki: {
    label: "Loki",
    role: "Development agent — changes this site",
    greeting: "What should this site do better?",
    placeholder: "Describe a change, a bug, an idea…",
    starters: [
      "Something on this page is broken",
      "Make this page easier to use on my phone",
      "I have an idea for a new feature",
    ],
    canBuild: true,
  },
  cat: {
    label: "Cat",
    role: "Economic agent — fund, pay, get paid",
    greeting: "Want to back this, or get paid for it?",
    placeholder: "Ask about funding, paying, offering…",
    starters: [
      "How can I support this project?",
      "Can I pay in Bitcoin or another way?",
      "I want to offer a service here",
    ],
    canBuild: false,
  },
};

export function defaultWidgetAgent(): WidgetAgentId {
  return "loki";
}

export function isWidgetAgentId(value: unknown): value is WidgetAgentId {
  return typeof value === "string" && (WIDGET_AGENT_IDS as readonly string[]).includes(value);
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Max turns sent per request, and per-turn length — mirrored by the route's zod caps. */
export const CHAT_MAX_TURNS = 16;
export const CHAT_MAX_TURN_CHARS = 4000;

/** The most recent turns that fit the server's caps. Oldest are dropped first. */
export function clampHistory(turns: readonly ChatTurn[]): ChatTurn[] {
  return turns
    .slice(-CHAT_MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, CHAT_MAX_TURN_CHARS) }));
}

/**
 * The conversation as a build brief for Loki Implement: the visitor's own
 * words first (they are the request), then Loki's last reply (its reading of
 * the request). Fits the ingest route's suggestion cap.
 */
export function conversationBrief(turns: readonly ChatTurn[], maxLen: number): string {
  const asked = turns.filter((t) => t.role === "user").map((t) => `- ${t.content.trim()}`);
  const lastReply = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")
    ?.content.trim();
  const parts = ["From a chat with Loki on this page.", "", "Visitor asked:", ...asked];
  if (lastReply) parts.push("", "Loki's reading:", lastReply);
  const text = parts.join("\n");
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}
