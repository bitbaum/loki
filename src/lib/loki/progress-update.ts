import type { FixNote } from "@/lib/feedback/fix-note";

/**
 * A progress update Loki posts into a chat thread — the way an engineering
 * team updates the person they work for: what was asked, what was actually
 * wrong, what was done and why that way, what else was weighed, what could
 * come next, and the evidence (a picture, the walkthrough, the change itself).
 *
 * It replaced a markdown block ("✅ project — done.", the agent's raw summary,
 * then "Pull request: https://…" as unlinked text). The owner's verdict on
 * that, 2026-10-11: "a lot of things written in big strings that is hard to
 * read and understand". Sections in a fixed order are what make an update
 * readable at a glance and comparable to the one before it.
 *
 * Stored on the message as `meta.update` (conversation_messages.meta), with a
 * plain-text rendering in `content` for search, copy and older clients.
 * Pure — no I/O — so scripts/test/progress-update.ts pins it.
 */

export const UPDATE_STAGE = {
  /** The work is done and waiting to merge (a pull request is open). */
  READY: "ready",
  /** Pushed straight to the branch; nothing will merge by itself. */
  PUSHED: "pushed",
  /** Live on the site. */
  LIVE: "live",
  /** Merged, but the deploy failed — the site still shows the old version. */
  DEPLOY_FAILED: "deploy_failed",
  /** Part of it was done. */
  PARTIAL: "partial",
  /** The run ended without the change. */
  NOT_DONE: "not_done",
} as const;
export type UpdateStage = (typeof UPDATE_STAGE)[keyof typeof UPDATE_STAGE];

/** The chip word and tone per stage. One table, so the card and the text agree. */
export const UPDATE_STAGE_LABEL: Record<
  UpdateStage,
  { label: string; tone: "positive" | "accent" | "warning" | "negative" }
> = {
  ready: { label: "Ready to merge", tone: "accent" },
  pushed: { label: "Pushed", tone: "accent" },
  live: { label: "Live", tone: "positive" },
  deploy_failed: { label: "Deploy failed", tone: "negative" },
  partial: { label: "Partly done", tone: "warning" },
  not_done: { label: "Not done", tone: "negative" },
};

export type UpdateLink = { label: string; href: string; primary?: boolean };
export type UpdateImage = { src: string; caption: string };

export type ProgressUpdate = {
  v: 1;
  stage: UpdateStage;
  project: string;
  /** One line under the chip: where it stands, in words. */
  headline: string;
  /** The sections, in reading order. Absent ones are simply not shown. */
  asked: string | null;
  problem: string | null;
  done: string | null;
  why: string | null;
  considered: { option: string; whyNot: string | null }[];
  next: string | null;
  /** Evidence the work was checked: tests, typecheck, a live verification. */
  checks: string | null;
  images: UpdateImage[];
  links: UpdateLink[];
};

export type ProgressUpdateInput = {
  stage: UpdateStage;
  project: string;
  /** The request, in the asker's words (a feedback report or a chat message). */
  asked?: string | null;
  note?: FixNote | null;
  /** The agent's handoff `done` — what was done when there is no note. */
  didLine?: string | null;
  /** The agent's handoff `next` — what could come next when the note is silent. */
  summaryNext?: string | null;
  checks?: string | null;
  /** Where the change shows (a page path), for the live headline. */
  where?: string | null;
  /** The deploy that failed, for the deploy-failed headline. */
  deployName?: string | null;
  images?: UpdateImage[];
  links?: UpdateLink[];
};

const ASKED_MAX = 280;
const FIELD_MAX = 600;

const tidy = (s: string | null | undefined, max = FIELD_MAX): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A handoff `next` that only says there is nothing to do is not a next step. */
const NOTHING = /^(none|nothing|n\/a|-|—|no(ne)? (follow[- ]?ups?|next steps?))\.?$/i;

function headlineFor(input: ProgressUpdateInput): string {
  const where = !input.where
    ? ""
    : input.where === "/"
      ? " on the home page"
      : ` on ${input.where}`;
  switch (input.stage) {
    case UPDATE_STAGE.READY:
      return "The change is written and checked. It merges on its own once its checks are green, and goes live with the deploy that follows.";
    case UPDATE_STAGE.PUSHED:
      return "Pushed straight to the branch — no pull request, so nothing merges by itself.";
    case UPDATE_STAGE.LIVE:
      return `It's live${where}. Watch the walkthrough to see the change on the real page.`;
    case UPDATE_STAGE.DEPLOY_FAILED:
      return `${input.deployName ?? "The deploy"} failed after the merge, so the site still shows the old version.`;
    case UPDATE_STAGE.PARTIAL:
      return "Part of it is done. What is left is under Next.";
    case UPDATE_STAGE.NOT_DONE:
      return "The run ended without the change. Nothing reached the site.";
  }
}

export function buildProgressUpdate(input: ProgressUpdateInput): ProgressUpdate {
  const note = input.note ?? null;
  const summaryNext = tidy(input.summaryNext);
  return {
    v: 1,
    stage: input.stage,
    project: input.project,
    headline: headlineFor(input),
    asked: tidy(input.asked, ASKED_MAX),
    problem: tidy(note?.problem),
    done: tidy(note?.change ?? input.didLine),
    why: tidy(note?.why),
    considered: (note?.considered ?? []).map((c) => ({
      option: tidy(c.option, 200) ?? "",
      whyNot: tidy(c.whyNot, 300),
    })),
    next: tidy(note?.next) ?? (summaryNext && !NOTHING.test(summaryNext) ? summaryNext : null),
    checks: tidy(input.checks, 200),
    images: (input.images ?? []).slice(0, 4),
    links: input.links ?? [],
  };
}

/** Section labels, in the order both renderings use. */
export const UPDATE_SECTIONS = [
  { key: "asked", label: "Asked" },
  { key: "problem", label: "What was wrong" },
  { key: "done", label: "What was done" },
  { key: "why", label: "Why this way" },
  { key: "next", label: "What could come next" },
  { key: "checks", label: "Checked" },
] as const;

/** The plain-text rendering stored in `content`: readable on its own, in the
 *  same order as the card, links as real markdown links. */
export function progressUpdateText(u: ProgressUpdate): string {
  const lines = [`**${u.project} — ${UPDATE_STAGE_LABEL[u.stage].label}.** ${u.headline}`];
  for (const s of UPDATE_SECTIONS) {
    if (s.key === "next" && u.considered.length) {
      lines.push(
        "",
        "**Also considered**",
        ...u.considered.map((c) => `- ${c.option}${c.whyNot ? ` — ${c.whyNot}` : ""}`),
      );
    }
    const value = u[s.key];
    if (value) lines.push("", `**${s.label}:** ${value}`);
  }
  if (u.links.length) lines.push("", u.links.map((l) => `[${l.label}](${l.href})`).join(" · "));
  return lines.join("\n");
}

/** Read an update back off a message's meta. Anything malformed is "none". */
export function readProgressUpdate(meta: unknown): ProgressUpdate | null {
  const u = (meta as { update?: unknown } | null)?.update as Partial<ProgressUpdate> | undefined;
  if (!u || u.v !== 1 || typeof u.stage !== "string" || !(u.stage in UPDATE_STAGE_LABEL))
    return null;
  if (typeof u.project !== "string" || typeof u.headline !== "string") return null;
  return {
    v: 1,
    stage: u.stage as UpdateStage,
    project: u.project,
    headline: u.headline,
    asked: typeof u.asked === "string" ? u.asked : null,
    problem: typeof u.problem === "string" ? u.problem : null,
    done: typeof u.done === "string" ? u.done : null,
    why: typeof u.why === "string" ? u.why : null,
    considered: Array.isArray(u.considered)
      ? u.considered.filter((c) => c && typeof c.option === "string")
      : [],
    next: typeof u.next === "string" ? u.next : null,
    checks: typeof u.checks === "string" ? u.checks : null,
    images: Array.isArray(u.images)
      ? u.images.filter((i) => i && typeof i.src === "string" && i.src.startsWith("/api/"))
      : [],
    links: Array.isArray(u.links)
      ? u.links.filter(
          (l) => l && typeof l.href === "string" && /^(https?:\/\/|\/)/.test(l.href) && l.label,
        )
      : [],
  };
}
