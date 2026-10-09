import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import {
  getActiveWidgetToken,
  upsertWidgetToken,
  revokeWidgetToken,
} from "@/db/queries/widget-tokens";
import { appUrl } from "@/lib/email";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { createOwnerPass, ownerSiteUrl } from "@/lib/feedback/owner-pass";
import type { WidgetToken } from "@/db/schema";
import { WIDGET_CORNERS, WIDGET_OFFSET_MAX, WIDGET_OFFSET_MIN } from "@/config/widget-placement";

/**
 * Owner management of a project's feedback-widget token: view the embed
 * snippet, create, update origins, rotate, revoke.
 * Same canonical-base-URL rule as the share route: build links from
 * appUrl(), never req.nextUrl.origin (behind Caddy that's the internal bind).
 */

const TokenBody = z.object({
  origins: z.array(z.string().url().max(200)).max(10).optional(),
  status: z.enum(["active", "paused"]).optional(),
  rotate: z.boolean().default(false),
  /** Where the launcher sits on the customer's page. Bounds mirror
   *  src/config/widget-placement.ts; the SSOT normalizer clamps on read too,
   *  so a row written before these bounds existed still resolves. */
  placement: z
    .object({
      corner: z.enum(WIDGET_CORNERS),
      offsetX: z.number().int().min(WIDGET_OFFSET_MIN).max(WIDGET_OFFSET_MAX),
      offsetY: z.number().int().min(WIDGET_OFFSET_MIN).max(WIDGET_OFFSET_MAX),
      autoAvoid: z.boolean(),
    })
    .optional(),
});

function withSnippet(t: WidgetToken) {
  const base = appUrl().replace(/\/$/, "");
  return {
    ...t,
    snippet: `<script src="${base}/widget.js" data-fc-project="${t.token}" async></script>`,
  };
}

/**
 * The owner's way onto their own site with Loki already there: the live URL
 * with the owner pass in the fragment (never sent to a server). Null until
 * the project has a live URL — a link to nowhere is not an invitation.
 */
async function openSiteUrl(userId: string, projectId: string): Promise<string | null> {
  const up = await getUserProjectByEntityId(userId, projectId);
  return up?.liveUrl ? ownerSiteUrl(up.liveUrl, createOwnerPass(projectId, userId)) : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const token = await getActiveWidgetToken(userId, idOrResp);
  return jsonOk({
    token: token ? withSnippet(token) : null,
    openSiteUrl: token ? await openSiteUrl(userId, idOrResp) : null,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, TokenBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const token = await upsertWidgetToken(userId, idOrResp, {
    origins: dataOrResp.origins?.map((o) => new URL(o).origin),
    status: dataOrResp.status,
    rotate: dataOrResp.rotate,
    placement: dataOrResp.placement,
  });
  if (!token) return jsonError("Project not found", 404);
  return jsonOk({ token: withSnippet(token), openSiteUrl: await openSiteUrl(userId, idOrResp) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  await revokeWidgetToken(userId, idOrResp);
  return jsonOk();
}
