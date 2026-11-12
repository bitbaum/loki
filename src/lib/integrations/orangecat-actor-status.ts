/**
 * OrangeCat → Loki: "what is happening to this person's projects?"
 *
 * OrangeCat's agent (Cat) could hand work to Loki — the build intent, the site
 * commission — and then never learn what became of it. This is the read that
 * closes the loop: OrangeCat signs `{ actorId, issuedAt }` on the shared
 * ORANGECAT_WEBHOOK_SECRET rail and gets back, for the Loki account that
 * signed in with that OrangeCat actor, each project's state, live site and
 * waiting feedback.
 *
 * The caller's side of the contract is orangecat
 * `src/services/loki/actor-status.ts`; change neither alone.
 *
 * Deliberately narrow: the fields OrangeCat's Cat acts on and nothing else —
 * no prompts, directories, tokens or agent internals cross the boundary.
 * Pure: the route does the queries, this shapes them, so it tests without a DB.
 */

import { APP_URL } from "@/config/brand";
import type { NeedsYouItem } from "@/lib/needs-you";

/** OrangeCat rejects nothing older; Loki rejects anything older than this. */
export const ACTOR_STATUS_MAX_AGE_MS = 5 * 60 * 1000;
export const ACTOR_STATUS_MAX_PROJECTS = 25;
const MAX_OUTCOMES = 5;
/** What Loki needs from its owner, as one line: long enough for a sentence. */
const MAX_NEEDS_YOU_CHARS = 200;
/** Lines of "needs you" sent: the Cat shows three, the rest are its reserve. */
export const ACTOR_NEEDS_YOU_MAX_ITEMS = 10;

export type ActorProjectState = "working" | "blocked" | "idle";

export interface ActorProjectStatus {
  id: string;
  name: string;
  lokiUrl: string;
  liveUrl: string | null;
  status: ActorProjectState;
  /** The CODE only: awaiting_user | external_dependency | manual_pause. */
  blockReason: string | null;
  /**
   * What Loki needs from its owner on this project, in one sentence, when it
   * is waiting on them — the agent's own "next" line, or what the block said.
   * Null when nothing is asked. Lets the Cat write an action, not a status.
   */
  needsYou: string | null;
  queueDepth: number;
  currentWork: string | null;
  recentOutcomes: string[];
  feedback: { new: number; open: number };
  orangecat: Array<{ entityType: string; entityId: string }>;
}

/** The slices of the existing query results this needs — structural, so tests
 *  pass plain objects and the DB row types can grow without touching this. */
export interface ActorStatusInput {
  projects: Array<{
    id: string;
    name: string;
    liveUrl: string | null;
    entityProjectId: string | null;
  }>;
  states: Array<{
    projectKey: string;
    agentRunning: boolean | null;
    sessionStatus: string | null;
    sessionBlockReason: string | null;
    /** The agent's own next step (session.md "next:"), when it wrote one. */
    sessionNext?: string | null;
    promptQueue: unknown[] | null;
    currentPromptLabel: string | null;
  }>;
  outcomes: Map<string, string[]>;
  feedback: Array<{ projectId: string; newCount: number; openCount: number }>;
  links: Array<{ projectId: string; entityType: string; entityId: string }>;
}

/** A request is fresh when issued within the window, in either direction (clock skew). */
export function isFreshIssuedAt(issuedAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(issuedAt);
  return Number.isFinite(t) && Math.abs(now - t) <= ACTOR_STATUS_MAX_AGE_MS;
}

const BLOCK_CODES = ["awaiting_user", "external_dependency", "manual_pause"] as const;

/**
 * Split an agent's block-reason into its code and its words. Agents write the
 * code and then say why ("awaiting_user — no high-impact work remains; the
 * shop is live"), so the raw text never equalled "awaiting_user" and every
 * reader comparing codes missed the most common block there is.
 */
export function parseBlockReason(raw: string | null | undefined): {
  code: string | null;
  detail: string | null;
} {
  const text = raw?.trim();
  if (!text) return { code: null, detail: null };
  const code = BLOCK_CODES.find((c) => text.toLowerCase().startsWith(c)) ?? null;
  if (!code) return { code: text, detail: null };
  const detail = text
    .slice(code.length)
    .replace(/^[\s—–:;,-]+/, "")
    .trim();
  return { code, detail: detail || null };
}

const sentence = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  const capped = t.length > MAX_NEEDS_YOU_CHARS ? `${t.slice(0, MAX_NEEDS_YOU_CHARS - 1)}…` : t;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
};

/**
 * What the owner is asked for, when a project waits on them. The autopilot's
 * brake ("no high-impact work remains") is not a question: it is Loki handing
 * the direction back, so it says that rather than "waiting on you".
 */
export function needsYouSentence(
  code: string | null,
  detail: string | null,
  next: string | null | undefined,
): string | null {
  if (code !== "awaiting_user") return null;
  if (detail && /no high-impact work remains/i.test(detail)) {
    return "Loki finished the work that mattered most. Pick what comes next.";
  }
  if (next?.trim()) return sentence(next);
  if (detail) return sentence(detail);
  return null;
}

/** An app path or an http(s) URL, made absolute; anything else is dropped. */
export function absoluteLokiHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/") && !href.startsWith("//")) return `${APP_URL}${href}`;
  return null;
}

/** One line of Loki's "needs you" list, as it crosses to OrangeCat. */
export interface ActorNeedsYouItem {
  key: string;
  label: string;
  reason: string | null;
  /** Absolute: OrangeCat links straight to the Loki page that acts on it. */
  href: string;
  urgent: boolean;
}

/**
 * Loki's own "needs you" list (lib/needs-you, the front door's composition),
 * as OrangeCat may show it: the counted tiers only — housekeeping is not need
 * — and only lines that lead somewhere, because a line nobody can act on is
 * the thing the owner asked never to be shown (2026-11-02, "read it and tap
 * once"). Privacy is already applied upstream: behind the PIN only the
 * approvals count leaves loadNeedsYouExtras.
 */
export function shapeActorNeedsYou(items: readonly NeedsYouItem[]): ActorNeedsYouItem[] {
  return items
    .filter((i) => i.tier !== "tidy")
    .flatMap((i) => {
      const href = absoluteLokiHref(i.href);
      return href
        ? [{ key: i.key, label: i.label, reason: i.reason ?? null, href, urgent: !!i.urgent }]
        : [];
    })
    .slice(0, ACTOR_NEEDS_YOU_MAX_ITEMS);
}

export function shapeActorStatus(input: ActorStatusInput): ActorProjectStatus[] {
  const stateByKey = new Map(input.states.map((s) => [s.projectKey.toLowerCase(), s]));
  // Feedback is keyed by the project's ENTITY id (site_feedback.project_id →
  // entities.id), which user_projects carries as entityProjectId.
  const feedbackByEntity = new Map(input.feedback.map((f) => [f.projectId, f]));

  const shaped = input.projects.map((p) => {
    const s = stateByKey.get(p.name.toLowerCase());
    const { code: blockReason, detail } = parseBlockReason(s?.sessionBlockReason);
    const status: ActorProjectState = blockReason
      ? "blocked"
      : s?.agentRunning || s?.sessionStatus === "working"
        ? "working"
        : "idle";
    const fb = p.entityProjectId ? feedbackByEntity.get(p.entityProjectId) : undefined;
    return {
      id: p.id,
      name: p.name,
      // The project page is keyed by the ENTITY id; `p.id` is the
      // user_projects row, so the old link opened a 404. Without an entity,
      // the by-name link lands on the projects list rather than nowhere.
      lokiUrl: p.entityProjectId
        ? `${APP_URL}/projects/${p.entityProjectId}`
        : `${APP_URL}/projects/go/${encodeURIComponent(p.name)}`,
      liveUrl: p.liveUrl && /^https?:\/\//i.test(p.liveUrl) ? p.liveUrl : null,
      status,
      blockReason,
      needsYou: needsYouSentence(blockReason, detail, s?.sessionNext),
      queueDepth: Array.isArray(s?.promptQueue) ? s.promptQueue.length : 0,
      currentWork: s?.currentPromptLabel ?? null,
      recentOutcomes: (input.outcomes.get(p.name) ?? []).slice(0, MAX_OUTCOMES),
      feedback: { new: fb?.newCount ?? 0, open: fb?.openCount ?? 0 },
      orangecat: input.links
        .filter((l) => l.projectId === p.id)
        .map((l) => ({ entityType: l.entityType, entityId: l.entityId })),
    };
  });

  // Cut to the cap only AFTER ordering by what needs the person. The cap used
  // to take the first 25 in list order, so an account with 37 projects never
  // showed OrangeCat's Cat its own `orangecat` project — the list order said
  // nothing about which ones mattered. Stable sort: ties keep list order.
  return shaped
    .map((project, index) => ({ project, index }))
    .sort((a, b) => attention(b.project) - attention(a.project) || a.index - b.index)
    .slice(0, ACTOR_STATUS_MAX_PROJECTS)
    .map(({ project }) => project);
}

/**
 * How much a project needs its owner right now — waiting on them first, then
 * new visitor feedback, then work in motion, then projects that exist in the
 * world (linked to OrangeCat, or live), then the rest.
 */
export function attention(p: ActorProjectStatus): number {
  if (p.status === "blocked") return p.blockReason === "awaiting_user" ? 100 : 80;
  if (p.feedback.new > 0) return 60 + Math.min(p.feedback.new, 19);
  if (p.status === "working") return 50;
  if (p.queueDepth > 0) return 40;
  if (p.orangecat.length > 0) return 30;
  if (p.liveUrl) return 20;
  return 0;
}

/** A provider key the person brought to Loki, as OrangeCat may know it. */
export interface ActorModelKey {
  /** Loki's vendor id ("xai", "openrouter", …). */
  vendor: string;
  model: string;
  /** "…abcd": the last characters only. */
  keyHint: string;
}

/**
 * Which provider keys this person holds on Loki, by NAME ONLY.
 *
 * The owner's xAI key was on Loki and not on OrangeCat (2026-11-11): Loki's
 * chat answered on grok while OrangeCat's Cat, for the same linked person, sat
 * on an exhausted free pool, and neither product could say the other had a
 * key. This lets OrangeCat say so. It is deliberately not a way to fetch a
 * key: the input type has no key in it, so no caller can pass one through.
 * `custom` endpoints are left out: their host is the person's own.
 */
export function shapeActorModelKeys(
  rows: Array<{ vendor: string; model: string; keyHint: string }>,
): ActorModelKey[] {
  const seen = new Set<string>();
  const out: ActorModelKey[] = [];
  for (const row of rows) {
    if (row.vendor === "custom" || seen.has(row.vendor)) continue;
    seen.add(row.vendor);
    out.push({ vendor: row.vendor, model: row.model, keyHint: row.keyHint });
  }
  return out;
}
