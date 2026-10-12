import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { createPreview } from "@/lib/previews/create";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiUserId } from "@/lib/session";

const Body = z.object({
  name: z.string().trim().min(1, "Name who the site is for.").max(80),
  about: z.string().trim().max(2000).optional(),
});

/**
 * Start a preview for someone who is not a customer yet: a folder on the box,
 * a project without a repository, the widget, and a build. Returns the link to
 * send and the owner link that lets their notes start changes.
 */
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to build a preview.", 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Check the form.", 400);
  if (!checkRateLimit(`preview-create:${userId}`, 20, RATE_LIMIT_WINDOW_LONG_MS)) {
    return jsonError("That is a lot of previews in an hour. Try again a little later.", 429);
  }
  const result = await createPreview(userId, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status);
  const { slug, projectId, previewUrl, ownerUrl, buildNote } = result;
  return jsonOk({ preview: { slug, projectId, previewUrl, ownerUrl, buildNote } }, { status: 201 });
}
