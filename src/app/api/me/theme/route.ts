import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { setUserTheme } from "@/db/queries/user-preferences";
import { THEME_MODES } from "@/config/theme";

/**
 * Save the light/dark choice made in Loki to the account, so the widget on
 * the owner's own site shows in the same mode (widget/theme-mode.ts). Called
 * by components/shell/ThemeSync.tsx whenever the choice changes.
 */
const Body = z.object({ theme: z.enum(THEME_MODES) });

export async function PUT(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  await setUserTheme(userId, body.theme);
  return jsonOk({ theme: body.theme });
}
