// Real data for the public landing hero — replaces the fabricated HOME_HERO_CONSOLE.
//
// TENANT-AGNOSTIC BY CONSTRUCTION. This used to take a userId and serve "the
// OWNER's real fleet (founder dogfooding)" — resolved via getDefaultUser(), so
// every stranger's first sight of Loki was one account's project list, shown
// because of who owned it rather than because anyone agreed to publish it.
// Loki is multi-tenant and the founder is tenant #1, so the hero now reads the
// SHOWCASE tier (owner-consented AND operator-featured) across every account,
// and its numbers are fleet-wide aggregates that identify nobody.
// See ./public-visibility.ts for the tiers and why there are two gates.
//
// It also replaces a hardcoded FLAGSHIPS = ["loki", "orangecat"] ordering — the
// ad-hoc version of "featured", which could only ever name the founder's own
// projects. featured_at is the real thing, and it is per project.
//
// Everything here stays PUBLIC-SAFE: counts + public project names + their
// one-line descriptions + a coarse running/idle dot. No dev-log notes, no task
// text. Honest by construction — `isLive` is true only when an agent is really
// running, so the hero never claims "LIVE" falsely.

import { getShowcaseProjects } from "./user-projects";
import { publicHeroNote } from "@/lib/project-display";

export type HeroFleetRow = {
  name: string;
  state: "running" | "queued" | "idle";
  note: string;
  /**
   * Who built it. A showcased project belongs to a TENANT, and a homepage that
   * shows their work without saying whose it is reads as "our projects" — which
   * is both untrue and the opposite of the reason to have a showcase. `href` is
   * set only when the owner has a handle to link to; `label` is what to print.
   * Both null = no byline rather than an invented one.
   */
  by: { label: string; href: string | null } | null;
};
export type HeroFleetSnapshot = {
  isLive: boolean;
  projects: HeroFleetRow[];
  metrics: { value: string; label: string }[];
};

/**
 * Fleet-wide counts. Tier 1 of public-visibility: an aggregate identifies
 * nobody, so it needs no consent — and unlike one account's list it grows
 * honestly as Loki gains users, which is the number a visitor actually wants.
 */
async function getFleetWideMetrics(): Promise<{ projects: number; running: number }> {
  const [[projects], [running]] = await Promise.all([
    db.select({ value: count() }).from(userProjects).where(eq(userProjects.isActive, true)),
    db.select({ value: count() }).from(projectStates).where(eq(projectStates.agentRunning, true)),
  ]);
  return { projects: projects?.value ?? 0, running: running?.value ?? 0 };
}

/**
 * The byline for a showcased project.
 *
 * Handle first, because @name is the public identity and /u/[username] is a
 * real page to send someone to — being credited AND linked is most of what a
 * tenant gets back for consenting. Display name is the fallback when there is
 * no handle (nothing to link to, so no link). Neither: no byline at all, and
 * never a stand-in label — Anonymous, or some generic phrase for a Loki user —
 * because that is a name we would be inventing for somebody.
 */
function byline(owner: { username: string | null; name: string | null }) {
  const handle = owner.username?.trim();
  if (handle) return { label: `@${handle}`, href: `/u/${handle}` };
  const name = owner.name?.trim();
  return name ? { label: name, href: null } : null;
}

/** A public-safe, real snapshot of the FLEET (not one account) for the hero. */
export async function getHeroFleetSnapshot(): Promise<HeroFleetSnapshot> {
  const [showcase, totals, runningKeys] = await Promise.all([
    getShowcaseProjects(),
    getFleetWideMetrics(),
    db
      .select({ projectKey: projectStates.projectKey })
      .from(projectStates)
      .where(eq(projectStates.agentRunning, true))
      .catch(() => [] as { projectKey: string }[]),
  ]);

  // Match a showcased project to a live agent by its canonical key. Cross-tenant
  // now, so compare on the key alone — two tenants may both run "api", and a dot
  // saying "something named api is running" is true either way and names nobody.
  const running = new Set(runningKeys.map((r) => r.projectKey.toLowerCase()));

  const projects: HeroFleetRow[] = showcase.map((p) => ({
    name: p.name,
    state: running.has(p.name.toLowerCase()) ? "running" : "idle",
    note: publicHeroNote(p.description) ?? "",
    by: byline(p.owner),
  }));

  return {
    isLive: totals.running > 0,
    projects,
    metrics: [
      {
        value: String(totals.projects),
        label: totals.projects === 1 ? "project" : "projects",
      },
      {
        value: String(totals.running),
        label: totals.running === 1 ? "agent running" : "agents running",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// "Shipped thanks to feedback" — the reverse rail of the feedback widget.
// Same doctrine as the hero snapshot: real data, public-safe by construction.
// Raw visitor text NEVER auto-publishes — only rows the operator explicitly
// featured (featured_at, resolved rows only) surface here, excerpted; the
// aggregate counts carry the story even before anything is featured.
// ---------------------------------------------------------------------------

// One import block for drizzle + db + tables, serving BOTH halves of this file.
// ES imports hoist, so the hero above reads them fine; two blocks would have
// meant two `eq`/`db` bindings and a duplicate-identifier error.
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, projectStates, siteFeedback, userProjects } from "@/db/schema";
import { getFeedbackLoopMetrics } from "./site-feedback";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";

export type ShippedFeedbackEntry = {
  excerpt: string;
  page: string | null;
  project: string;
  resolvedAt: string;
};
export type ShippedFeedbackSnapshot = {
  resolvedCount: number;
  medianResolutionHours: number | null;
  entries: ShippedFeedbackEntry[];
};

const STRIP_MAX_ENTRIES = 3;
const EXCERPT_LEN = 140;

export async function getShippedFromFeedbackSnapshot(
  userId: string,
): Promise<ShippedFeedbackSnapshot> {
  const [loop, rows] = await Promise.all([
    getFeedbackLoopMetrics(userId),
    db
      .select({
        suggestion: siteFeedback.suggestion,
        page: siteFeedback.page,
        project: entities.name,
        resolvedAt: siteFeedback.resolvedAt,
      })
      .from(siteFeedback)
      .innerJoin(entities, eq(siteFeedback.projectId, entities.id))
      .where(
        and(
          eq(siteFeedback.userId, userId),
          eq(siteFeedback.status, FEEDBACK_STATUS.RESOLVED),
          isNotNull(siteFeedback.featuredAt),
        ),
      )
      .orderBy(desc(sql`${siteFeedback.featuredAt}`))
      .limit(STRIP_MAX_ENTRIES),
  ]);

  return {
    resolvedCount: loop.resolved,
    medianResolutionHours: loop.medianResolutionHours,
    entries: rows.map((r) => ({
      excerpt:
        r.suggestion.length > EXCERPT_LEN ? `${r.suggestion.slice(0, EXCERPT_LEN)}…` : r.suggestion,
      page: r.page,
      project: r.project,
      resolvedAt: (r.resolvedAt ?? new Date()).toISOString(),
    })),
  };
}
