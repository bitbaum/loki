/**
 * The agents a visitor can talk to from the widget's Chat mode.
 *
 * One conversation surface, three agents — one per plane of the fleet:
 *   loki  — execution: what should change on this site; hands the conversation
 *           to Loki Implement as a build brief.
 *   cat   — economy (OrangeCat): funding, paying, offering, getting paid;
 *           hands off to the visitor's own Cat.
 *   solon — governance: who decides, and how; turns the conversation into a
 *           pre-filled proposal on Solon.
 *
 * Each agent's "custom version" of the chat lives in its meta below — its
 * greeting, starters, and above all its ACTION, the one thing the agent can do
 * with a conversation. Richer agent-specific surfaces (a payment card for Cat,
 * a vote card for Solon) belong behind that same seam, not in a fork of chat.ts.
 *
 * DOM-free so the Node tests can read it. The server holds the matching
 * personas in src/config/widget-agents.ts; scripts/test/widget-agents.ts fails
 * if the two id lists drift.
 */
export const WIDGET_AGENT_IDS = ["loki", "cat", "solon"] as const;
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
  /**
   * What the visitor can do with the conversation once the agent has answered:
   *   build — file it with Loki Implement (/api/feedback)
   *   link  — open the agent's home, served by boot as `handoffs[agent]`; with
   *           `prefill`, the conversation's gist rides along in the query
   */
  action: { kind: "build"; label: string } | { kind: "link"; label: string; prefill: boolean };
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
    action: { kind: "build", label: "Send to Loki to build" },
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
    action: { kind: "link", label: "Continue with your Cat on OrangeCat ↗", prefill: false },
  },
  solon: {
    label: "Solon",
    role: "Governance agent — propose, vote, decide",
    greeting: "Something here that should be decided together?",
    placeholder: "Ask who decides, or draft a proposal…",
    starters: [
      "Who decides how this project spends money?",
      "I want to propose a change to how this works",
      "How do Bitcoin-signed votes work?",
    ],
    action: { kind: "link", label: "Draft this as a proposal on Solon ↗", prefill: true },
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
 * The conversation as a brief — a build request for Loki Implement, or a
 * proposal body for Solon: the visitor's own words first (they are the
 * request), then the agent's last reply (its reading of it). Fits `maxLen`.
 */
export function conversationBrief(
  turns: readonly ChatTurn[],
  maxLen: number,
  agentLabel = "Loki",
): string {
  const asked = turns.filter((t) => t.role === "user").map((t) => `- ${t.content.trim()}`);
  const lastReply = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")
    ?.content.trim();
  const parts = [`From a chat with ${agentLabel}.`, "", "Visitor asked:", ...asked];
  if (lastReply) parts.push("", `${agentLabel}'s reading:`, lastReply);
  const text = parts.join("\n");
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

/** A proposal title from the visitor's first message: one line, capped. */
export function proposalTitle(turns: readonly ChatTurn[], maxLen = 120): string {
  const first =
    turns
      .find((t) => t.role === "user")
      ?.content.trim()
      .split("\n")[0] ?? "";
  return first.length <= maxLen ? first : `${first.slice(0, maxLen - 1)}…`;
}

/**
 * The handoff URL for a "link" action. With `prefill`, the conversation rides
 * along as `title` / `body` / `from` — the query Solon's /propose reads
 * (solon: src/lib/domain/proposal-draft.ts). The body is capped so the whole
 * URL stays well under what browsers and proxies accept.
 */
export function handoffHref(
  base: string,
  prefill: boolean,
  turns: readonly ChatTurn[],
  agentLabel: string,
): string {
  if (!prefill) return base;
  const url = new URL(base);
  url.searchParams.set("from", "loki-widget");
  url.searchParams.set("title", proposalTitle(turns));
  url.searchParams.set("body", conversationBrief(turns, 1500, agentLabel));
  return url.toString();
}
