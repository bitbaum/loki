/**
 * The widget's two ways of asking Loki something, as plain calls — the
 * conversation (widget/conversation.ts) decides which one a site gets
 * (thread.ts assistantFor) and renders the answer.
 *
 *   advisor   — POST /api/widget/advise: about THIS site, from an outline the
 *               visitor's own browser builds (page-snapshot.ts), plus Watch's
 *               session when it is a Review.
 *   concierge — POST /api/widget/chat: a studio front desk, answered from the
 *               public fleet map by the Cat and Loki.
 *
 * Every field is clamped to the route's own cap; the routes reject a request
 * outright on one character over, and the person would lose their message.
 */
import type { SelectedEl } from "./picker";
import { SNAPSHOT_MAX_CHARS, takeSnapshot, type SnapshotScope } from "./page-snapshot";
import { REVIEW_SESSION_MAX } from "./watch-trail";
import { safeHttpUrl, type Link, type Speaker } from "./thread";

/** Mirror ADVISE_MAX_QUESTION / ADVISE_MAX_HISTORY in src/lib/widget-advise/advisor.ts. */
export const ADVISE_MAX_QUESTION = 1000;
export const ADVISE_MAX_HISTORY = 8;
/** Mirror WIDGET_CHAT_MAX_MESSAGE / _MAX_HISTORY in src/app/api/widget/chat/route.ts. */
export const CHAT_MAX_MESSAGE = 1000;
export const CHAT_MAX_HISTORY = 12;

/** What the owner "asks" when they press Review. */
export const REVIEW_QUESTION = "Review what I just did on this site. What should be improved?";

type Turn = { role: "user" | "assistant"; content: string };

export type Answer = {
  messages: { speaker: Speaker; text: string }[];
  changes: string[];
  links: Link[];
  degraded: boolean;
};

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json || typeof json.reply !== "string" || !json.reply) {
    throw new Error(
      typeof json?.error === "string" ? json.error : `Loki could not answer (${res.status})`,
    );
  }
  return json;
}

export async function askAdvisor(opts: {
  apiBase: string;
  token: string;
  question: string;
  scope: SnapshotScope;
  selected: SelectedEl[];
  history: Turn[];
  /** Watch's session — present for a Review. */
  session?: string;
  /** The owner's pass, so Loki answers the person whose site it is as such. */
  ownerPass?: string;
}): Promise<Answer> {
  const snapshot = (await takeSnapshot(opts.scope, opts.selected)).slice(0, SNAPSHOT_MAX_CHARS);
  const body = await post(`${opts.apiBase}/api/widget/advise`, {
    token: opts.token,
    question: opts.question.slice(0, ADVISE_MAX_QUESTION),
    scope: opts.scope,
    snapshot,
    session: opts.session ? opts.session.slice(0, REVIEW_SESSION_MAX) : undefined,
    ownerPass: opts.ownerPass,
    history: opts.history
      .slice(-ADVISE_MAX_HISTORY)
      .map((t) => ({ ...t, content: t.content.slice(0, 3000) })),
  });
  const changes = (Array.isArray(body.changes) ? body.changes : [])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.slice(0, 300))
    .slice(0, 5);
  return {
    messages: [{ speaker: "loki", text: String(body.reply).slice(0, 6000) }],
    changes,
    links: [],
    degraded: body.degraded === true,
  };
}

export async function askConcierge(opts: {
  apiBase: string;
  token: string;
  message: string;
  history: Turn[];
}): Promise<Answer> {
  const body = await post(`${opts.apiBase}/api/widget/chat`, {
    token: opts.token,
    message: opts.message.slice(0, CHAT_MAX_MESSAGE),
    history: opts.history
      .slice(-CHAT_MAX_HISTORY)
      .map((t) => ({ ...t, content: t.content.slice(0, 2000) })),
    url: location.href.slice(0, 1000),
    pageTitle: document.title.slice(0, 300) || undefined,
  });
  const said = (Array.isArray(body.messages) ? body.messages : [])
    .map((m) => (m ?? {}) as { speaker?: unknown; text?: unknown })
    .filter((m) => typeof m.text === "string" && m.text.trim())
    .map((m) => ({
      speaker: (m.speaker === "cat" ? "cat" : "loki") as Speaker,
      text: String(m.text).slice(0, 4000),
    }));
  const links = (Array.isArray(body.links) ? body.links : [])
    .map((l) => (l ?? {}) as { label?: unknown; url?: unknown })
    .map((l) => ({ label: String(l.label ?? "").slice(0, 80), url: safeHttpUrl(l.url) }))
    .filter((l): l is Link => !!l.url && !!l.label)
    .slice(0, 5);
  return {
    messages: said.length ? said : [{ speaker: "loki", text: String(body.reply).slice(0, 4000) }],
    changes: [],
    links,
    degraded: body.degraded === true,
  };
}
