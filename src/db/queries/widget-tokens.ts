import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, userProjects, widgetTokens, type WidgetToken } from "@/db/schema";
import { ENTITY_TYPE, WIDGET_TOKEN_STATUS, type WidgetTokenStatus } from "@/lib/constants/statuses";
import { fetchAttributesByEntityIds } from "./utils";
import { resolveProjectPublicOrigin } from "@/lib/feedback/project-site";
import type { WidgetPlacement } from "@/config/widget-placement";

/**
 * Default a new token's origin allowlist from the project's live site
 * (user_projects.liveUrl first — Hetzner SSOT — then legacy attrs).
 */
async function defaultOriginsFromProject(
  userId: string,
  projectId: string,
): Promise<string[] | null> {
  const origin = await resolveProjectPublicOrigin(userId, projectId);
  return origin ? [origin] : null;
}

/** Token prefix — makes a leaked string instantly identifiable as a
 *  write-only feedback-widget token (cf. ck_* agent tokens). */
const TOKEN_PREFIX = "fcw_";

function newToken(): string {
  return TOKEN_PREFIX + randomBytes(16).toString("hex");
}

export async function getActiveWidgetToken(
  userId: string,
  projectId: string,
): Promise<WidgetToken | null> {
  const row = await db.query.widgetTokens.findFirst({
    where: and(
      eq(widgetTokens.userId, userId),
      eq(widgetTokens.projectId, projectId),
      isNull(widgetTokens.revokedAt),
    ),
  });
  return row ?? null;
}

/** Resolve a token string from the public ingest route. Active tokens only. */
export async function getWidgetTokenByToken(token: string): Promise<WidgetToken | null> {
  const row = await db.query.widgetTokens.findFirst({
    where: and(eq(widgetTokens.token, token), isNull(widgetTokens.revokedAt)),
  });
  return row ?? null;
}

/** The project a widget token belongs to, by name — grounds the widget's chat agents. */
export async function getWidgetProjectName(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: entities.name })
    .from(entities)
    .where(eq(entities.id, projectId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Record a widget boot heartbeat — this is what makes the UI's "Live ✓"
 * observed truth. Throttled to one write per token per minute so a busy
 * customer page doesn't turn every view into an UPDATE.
 */
export async function touchWidgetToken(tokenId: string, origin: string | null): Promise<void> {
  await db
    .update(widgetTokens)
    .set({ lastSeenAt: new Date(), lastSeenOrigin: origin })
    .where(
      and(
        eq(widgetTokens.id, tokenId),
        or(
          isNull(widgetTokens.lastSeenAt),
          lt(widgetTokens.lastSeenAt, sql`now() - interval '60 seconds'`),
        ),
      ),
    );
}

export type WidgetTokenInput = {
  origins?: string[];
  /** Remote kill switch — 'paused' makes the boot call render nothing. */
  status?: WidgetTokenStatus;
  /** Revoke the current token and mint a fresh one (invalidates the old snippet). */
  rotate?: boolean;
  /** Where the launcher sits on the customer's page — served by the boot call,
   *  so repositioning needs no change to their HTML. */
  placement?: WidgetPlacement;
};

/**
 * Create the project's widget token if none exists; otherwise update its
 * origins — or mint a replacement when `rotate` is set. Returns null when
 * the project doesn't exist or isn't owned by the user.
 */
export async function upsertWidgetToken(
  userId: string,
  projectId: string,
  input: WidgetTokenInput = {},
): Promise<WidgetToken | null> {
  const project = await db.query.entities.findFirst({
    where: and(
      eq(entities.id, projectId),
      eq(entities.userId, userId),
      eq(entities.type, ENTITY_TYPE.PROJECT),
    ),
    columns: { id: true },
  });
  if (!project) return null;

  const existing = await getActiveWidgetToken(userId, projectId);
  const origins =
    input.origins?.filter(Boolean) ??
    existing?.origins ??
    (await defaultOriginsFromProject(userId, projectId));
  const status = input.status ?? existing?.status ?? WIDGET_TOKEN_STATUS.ACTIVE;
  // Carried across a rotate on purpose: rotating invalidates the snippet, not
  // the operator's decision about where the launcher belongs on their page.
  const placement = input.placement ?? existing?.placement ?? null;

  if (existing && !input.rotate) {
    const [updated] = await db
      .update(widgetTokens)
      .set({ origins, status, placement })
      .where(and(eq(widgetTokens.id, existing.id), eq(widgetTokens.userId, userId)))
      .returning();
    return updated ?? null;
  }

  if (existing) await revokeWidgetToken(userId, projectId);

  const [created] = await db
    .insert(widgetTokens)
    .values({ userId, projectId, token: newToken(), origins, status, placement })
    .returning();
  return created ?? null;
}

export async function revokeWidgetToken(userId: string, projectId: string): Promise<boolean> {
  const [revoked] = await db
    .update(widgetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(widgetTokens.userId, userId),
        eq(widgetTokens.projectId, projectId),
        isNull(widgetTokens.revokedAt),
      ),
    )
    .returning({ id: widgetTokens.id });
  return Boolean(revoked);
}

const LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type WidgetCoverageItem = {
  projectId: string;
  projectName: string;
  hasToken: boolean;
  tokenStatus: string | null;
  lastSeenAt: string | null;
  lastSeenOrigin: string | null;
  productionUrl: string | null;
  gitUrl: string | null;
  /** The install agent can land the snippet: a git URL to clone OR a local
   *  runner directory. The install route 422s only when BOTH are missing —
   *  the UI must not gate harder than the route it calls. */
  canInstall: boolean;
  /** Boot heartbeat within the last 7 days. */
  live: boolean;
  /** Missing token, paused, or never/not recently seen on a site-like project. */
  needsAttention: boolean;
};

/**
 * Fleet lens: which public sites should carry the feedback widget, and which
 * are missing / not live. Site-like = has user_projects.liveUrl or legacy
 * production_url/url — never gitUrl alone. Prefer liveUrl (Hetzner) over
 * stale entity attrs.
 */
export async function listWidgetCoverage(userId: string): Promise<WidgetCoverageItem[]> {
  const projects = await db
    .select({ id: entities.id, name: entities.name, gitUrl: entities.gitUrl })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT)));

  if (projects.length === 0) return [];

  const [tokens, ups] = await Promise.all([
    db
      .select()
      .from(widgetTokens)
      .where(and(eq(widgetTokens.userId, userId), isNull(widgetTokens.revokedAt))),
    db
      .select({
        entityProjectId: userProjects.entityProjectId,
        liveUrl: userProjects.liveUrl,
        gitUrl: userProjects.gitUrl,
        dirPath: userProjects.dirPath,
      })
      .from(userProjects)
      .where(eq(userProjects.userId, userId)),
  ]);
  const tokenByProject = new Map(tokens.map((t) => [t.projectId, t]));
  const upByEntity = new Map(
    ups.filter((u) => u.entityProjectId).map((u) => [u.entityProjectId!, u]),
  );
  const attrs = await fetchAttributesByEntityIds(projects.map((p) => p.id));
  const now = Date.now();

  return projects
    .map((p) => {
      const t = tokenByProject.get(p.id);
      const up = upByEntity.get(p.id);
      const a = attrs.get(p.id) ?? {};
      const raw = up?.liveUrl ?? a.production_url ?? a.url ?? null;
      let productionUrl: string | null = null;
      if (raw) {
        try {
          productionUrl = new URL(raw.startsWith("http") ? raw : `https://${raw}`).origin;
        } catch {
          productionUrl = null;
        }
      }
      const live = !!(t?.lastSeenAt && now - t.lastSeenAt.getTime() < LIVE_WINDOW_MS);
      const siteLike = !!productionUrl;
      const needsAttention = siteLike && (!t || t.status !== WIDGET_TOKEN_STATUS.ACTIVE || !live);
      return {
        projectId: p.id,
        projectName: p.name,
        hasToken: !!t,
        tokenStatus: t?.status ?? null,
        lastSeenAt: t?.lastSeenAt?.toISOString() ?? null,
        lastSeenOrigin: t?.lastSeenOrigin ?? null,
        productionUrl,
        gitUrl: up?.gitUrl ?? p.gitUrl ?? null,
        canInstall: !!(up?.gitUrl || p.gitUrl || up?.dirPath),
        live,
        needsAttention,
      };
    })
    .filter((p) => !!p.productionUrl)
    .sort(
      (a, b) =>
        Number(b.needsAttention) - Number(a.needsAttention) ||
        a.projectName.localeCompare(b.projectName),
    );
}
