/**
 * OrangeCat publish — project publish (Part C) + changelog→wall promote step.
 *
 * "Loki emits, OrangeCat distributes": Loki keeps the private
 * build truth; this module projects the publish-worthy slice onto OrangeCat.
 *
 * - publishProjectToOrangeCat: opt-in, per project. Creates the OC project as
 *   the USER's actor (their OIDC access token from Login with OrangeCat) and
 *   stores the back-link on user_projects.orangecatProjectId.
 *   Account linking alone never publishes; publish consent is this call.
 * - promoteMomentToOrangeCat: async + fire-and-forget + idempotent. Consults
 *   PROMOTE_POLICY (src/config/orangecat-publish.ts) and posts onto the OC
 *   publish bus with a stable dedupe id, so retries never double-post.
 *   Backfill must not promote moments from before the publish opt-in.
 */

import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { userProjects, type DevLogEntry } from "@/db/schema";
import { getOrangeCatLink } from "./orangecat-identity";
import { OC_BASE } from "./orangecat";
import { PROMOTE_POLICY, type PromotableMoment } from "@/config/orangecat-publish";
import { linkOrangeCatEntity, unlinkOrangeCatEntity } from "@/db/queries/orangecat-links";
import { mayPostActivity, wallLinkFor } from "./orangecat-wall-link";
import { ECOSYSTEM } from "@/config/ecosystem";
import { cleanDescription } from "@/lib/project-display";
import { buildRunMoment, type RunPromoteInput } from "./orangecat-run-moment";
import { buildOrangeCatProjectPayload } from "./orangecat-project-payload";

export type { RunPromoteInput } from "./orangecat-run-moment";

export interface PublishResult {
  ok: boolean;
  orangecatProjectId?: string;
  /** Machine-readable failure cause for the UI. */
  reason?: "not_linked" | "not_found" | "already_published" | "oc_error";
}

/**
 * Publish a Loki project to OrangeCat as a public project entity owned
 * by the user's OC actor. Idempotent at our layer: a project that already has
 * an orangecatProjectId is not re-published.
 */
export async function publishProjectToOrangeCat(
  userId: string,
  userProjectId: string,
  /**
   * The activity-feed decision, taken at the same moment as the page. Passed
   * explicitly so publishing RECORDS an answer rather than leaving `null`,
   * which would mean the wall stays silent until someone finds a switch they
   * do not know exists — the failure mode the listing prompt was built to
   * avoid one column over.
   */
  opts: { autopost?: boolean } = {},
): Promise<PublishResult> {
  const autopost = opts.autopost ?? true;
  // The projects UI addresses projects by their entity id; the back-link
  // lives on user_projects — accept either.
  const project = await db.query.userProjects.findFirst({
    where: and(
      eq(userProjects.userId, userId),
      or(eq(userProjects.id, userProjectId), eq(userProjects.entityProjectId, userProjectId)),
    ),
  });
  if (!project) return { ok: false, reason: "not_found" };
  if (project.orangecatProjectId) {
    return {
      ok: true,
      orangecatProjectId: project.orangecatProjectId,
      reason: "already_published",
    };
  }

  const link = await getOrangeCatLink(userId);
  if (!link) return { ok: false, reason: "not_linked" };

  try {
    const res = await fetch(`${OC_BASE}/api/v1/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${link.accessToken}`,
        "Idempotency-Key": `loki_project_${project.id}`,
      },
      body: JSON.stringify(buildOrangeCatProjectPayload(project)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn("[orangecat-publish] project publish failed", {
        userProjectId,
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return { ok: false, reason: "oc_error" };
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const ocProjectId = json.data?.id;
    if (!ocProjectId) return { ok: false, reason: "oc_error" };

    await db
      .update(userProjects)
      .set({ orangecatProjectId: ocProjectId, orangecatAutopost: autopost, updatedAt: new Date() })
      .where(eq(userProjects.id, project.id));

    await linkOrangeCatEntity({
      userId,
      projectId: project.id,
      entityType: "project",
      entityId: ocProjectId,
      role: "funding",
      publicUrl: new URL(`/projects/${ocProjectId}`, ECOSYSTEM.orangeCat.siteUrl).toString(),
      title: project.name,
    });

    // First moment on the wall: the project went public.
    void promoteMomentToOrangeCat(userId, project.id, "project_published", {
      externalId: `loki_project_published_${project.id}`,
      title: `${project.name} is now building in public`,
      description: cleanDescription(project.description) ?? undefined,
      subjectId: ocProjectId,
    });

    return { ok: true, orangecatProjectId: ocProjectId };
  } catch (err) {
    console.warn("[orangecat-publish] project publish errored", { userProjectId, err });
    return { ok: false, reason: "oc_error" };
  }
}

export type UnpublishResult =
  | { ok: true; reason?: "not_published" }
  | { ok: false; reason: "not_found" | "not_linked" | "oc_error" | "oc_too_old"; detail?: string };

/**
 * Take a published project back off OrangeCat.
 *
 * Publishing was one-way. Loki could create the public page and had no
 * way to remove it: the status primitive lived behind OrangeCat's session auth,
 * which an integration holding an OAuth token cannot call, and the back-link
 * this file writes could never be cleared — so `already_published` was a
 * permanent verdict and the page stayed up for good.
 *
 * Unpublishing sets the OrangeCat project back to `draft`. That is the state
 * that is owner-only there (its public-visibility list is `active` and
 * `completed`, mirroring the row-level policy), and it is reversible: the
 * project, its funding history and its wall survive, and publishing again
 * returns it to `active`. Deleting the OrangeCat project is deliberately NOT
 * what this does — that is theirs to do, on their side, with their data.
 *
 * The back-link is cleared only after OrangeCat confirms, so a failed call
 * leaves a project that still knows where it was published.
 */
export async function unpublishProjectFromOrangeCat(
  userId: string,
  userProjectId: string,
): Promise<UnpublishResult> {
  const project = await db.query.userProjects.findFirst({
    where: and(
      eq(userProjects.userId, userId),
      or(eq(userProjects.id, userProjectId), eq(userProjects.entityProjectId, userProjectId)),
    ),
  });
  if (!project) return { ok: false, reason: "not_found" };
  if (!project.orangecatProjectId) return { ok: true, reason: "not_published" };

  const link = await getOrangeCatLink(userId);
  if (!link) return { ok: false, reason: "not_linked" };

  try {
    const res = await fetch(`${OC_BASE}/api/v1/projects/${project.orangecatProjectId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${link.accessToken}`,
      },
      body: JSON.stringify({ status: "draft" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 405) {
      // The endpoint that makes this possible shipped on 2026-09-11. An
      // OrangeCat older than that cannot be asked, and saying so is better
      // than clearing our back-link and leaving their page public.
      return { ok: false, reason: "oc_too_old" };
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.warn("[orangecat-publish] unpublish failed", {
        userProjectId,
        status: res.status,
        detail,
      });
      return { ok: false, reason: "oc_error", detail };
    }
  } catch (err) {
    console.warn("[orangecat-publish] unpublish errored", { userProjectId, err });
    return { ok: false, reason: "oc_error" };
  }

  await db
    .update(userProjects)
    // The feed decision goes with the page it was about. Keeping a stale
    // `true` would mean re-publishing later silently resumed posting on the
    // strength of consent given for a page that was taken down since.
    .set({ orangecatProjectId: null, orangecatAutopost: null, updatedAt: new Date() })
    .where(eq(userProjects.id, project.id));
  await unlinkOrangeCatEntity({ userId, projectId: project.id, entityType: "project" });
  return { ok: true };
}

interface PromoteContent {
  /** Stable id from OUR event spine — OC's idempotency key. */
  externalId: string;
  title: string;
  description?: string;
  /** OC project id; resolved from the back-link when omitted. */
  subjectId?: string;
  content?: Record<string, unknown>;
}

/** Outcome of a promote attempt — lets the backfill janitor count and report. */
export type PromoteOutcome = "posted" | "skipped" | "failed";

/**
 * Promote one publish-worthy moment onto the OrangeCat wall. Never throws,
 * never blocks the user action (call sites may `void` it); a dropped promote
 * is recoverable by the backfill cron because external ids are deterministic.
 */
export async function promoteMomentToOrangeCat(
  userId: string,
  userProjectId: string,
  moment: PromotableMoment,
  input: PromoteContent,
): Promise<PromoteOutcome> {
  const policy = PROMOTE_POLICY[moment];
  if (!policy?.enabled) return "skipped";

  try {
    // Read the row even when the caller supplied a subject id: the wall entry
    // needs somewhere to point BACK to, and that is a property of the project,
    // not of the moment.
    const project = await db.query.userProjects.findFirst({
      where: and(eq(userProjects.id, userProjectId), eq(userProjects.userId, userId)),
      columns: {
        orangecatProjectId: true,
        slug: true,
        gitUrl: true,
        name: true,
        listedPublicly: true,
        orangecatAutopost: true,
      },
    });
    const subjectId = input.subjectId ?? project?.orangecatProjectId ?? undefined;
    if (!subjectId) return "skipped"; // not published to OC — nothing to promote onto

    // Consent to a PAGE is not consent to a FEED. Publishing used to enrol the
    // project in a live stream of everything its agents did, and the only way
    // to stop it was to take the public page down. Explicit `true` or nothing
    // is posted: `null` means nobody has answered, and an unanswered question
    // is not a yes.
    //
    // No exceptions, the publish announcement included. An exemption for "the
    // page went up" is defensible on its own terms and still wrong: it would
    // make the rule "Loki posts nothing, except the one it decided you meant",
    // and the person switching this off is switching off exactly the class of
    // surprise that carve-out belongs to. Publishing with the feed on is one
    // press and records both answers, so nothing is lost by the strict rule.
    if (!mayPostActivity(project)) return "skipped";

    const link = await getOrangeCatLink(userId);
    if (!link) return "skipped";

    const res = await fetch(`${OC_BASE}/api/v1/timeline/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${link.accessToken}`,
      },
      body: JSON.stringify({
        source: "loki",
        external_id: input.externalId,
        event_type: policy.eventType,
        subject_type: "project",
        subject_id: subjectId,
        title: input.title.slice(0, 200),
        description: input.description?.slice(0, 2000),
        url: wallLinkFor(project),
        content: input.content,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn("[orangecat-publish] promote failed (non-fatal)", {
        userProjectId,
        moment,
        externalId: input.externalId,
        status: res.status,
      });
      return "failed";
    }
    return "posted";
  } catch (err) {
    console.warn("[orangecat-publish] promote errored (non-fatal)", {
      userProjectId,
      moment,
      err,
    });
    return "failed";
  }
}

/**
 * Promote a freshly appended dev-log entry (the changelog→wall loop).
 * Deterministic external id = hash of the entry, so the same entry retried
 * never double-posts (OC reconciles on source + external_id).
 */
export function promoteDevLogEntry(
  userId: string,
  userProjectId: string,
  projectName: string,
  entry: DevLogEntry,
): Promise<PromoteOutcome> {
  const digest = createHash("sha256").update(JSON.stringify(entry)).digest("hex").slice(0, 24);
  return promoteMomentToOrangeCat(userId, userProjectId, "devlog_entry", {
    externalId: `loki_devlog_${userProjectId}_${digest}`,
    title: `${projectName}: ${firstLine(entry.done) || "progress update"}`,
    description: [entry.done, entry.next ? `Next: ${entry.next}` : null]
      .filter(Boolean)
      .join("\n\n"),
    content: { health: entry.health, date: entry.date },
  });
}

/**
 * Promote a successfully closed orchestration run onto the OrangeCat wall
 * (ledger-and-loop item 2: run work becomes visible economic activity).
 * Fire-and-forget contract like every promote: never throws, "skipped" when
 * the project isn't OC-published or the user isn't linked; a dropped emit is
 * re-sent by the daily backfill janitor.
 */
export async function promoteRunClose(run: RunPromoteInput): Promise<PromoteOutcome> {
  try {
    // runs carry projectKey (= user_projects.name, the tab identifier);
    // the promote layer addresses projects by their user_projects row.
    const project = await db.query.userProjects.findFirst({
      where: and(eq(userProjects.userId, run.userId), eq(userProjects.name, run.projectKey)),
      columns: { id: true, name: true, orangecatProjectId: true },
    });
    if (!project?.orangecatProjectId) return "skipped";
    return await promoteMomentToOrangeCat(
      run.userId,
      project.id,
      "run_closed",
      buildRunMoment(project.name, run),
    );
  } catch (err) {
    console.warn("[orangecat-publish] run promote errored (non-fatal)", { runId: run.id, err });
    return "failed";
  }
}

function firstLine(s: string | undefined): string {
  return (s ?? "").split("\n")[0].trim().slice(0, 160);
}
