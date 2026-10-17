import { NextRequest } from "next/server";
import { PREVIEWS } from "@/config/previews";
import { findPreviewProject } from "@/db/queries/previews";
import { getPreviewCode } from "@/db/queries/preview-code";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import {
  createPreviewAccessCookie,
  previewAccessSetCookie,
  previewCodeFor,
} from "@/lib/previews/access";
import { previewDirFor } from "@/lib/previews/root";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiUserId } from "@/lib/session";

/**
 * The owner's own door into their preview: the access cookie for it, minted
 * from the code they set, without typing the code. Owner only — the project
 * the folder belongs to must be theirs. The answer sets the cookie for Loki's
 * own /p/ path and names it in the body, so an automated check on the box
 * (scripts/hetzner/preview-check-on-box.sh) can open the preview's own host
 * with it. It reveals nothing the owner does not hold: the cookie is derived
 * from their code, and the code is theirs.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to open your preview.", 401);
  if (!checkRateLimit(`preview-cookie:${userId}`, 60, RATE_LIMIT_WINDOW_LONG_MS))
    return jsonError("Too many asks. Try again a little later.", 429);
  const { slug } = await params;
  const dir = previewDirFor(slug);
  const project = dir ? await findPreviewProject(dir) : null;
  if (!project || project.userId !== userId) return jsonError("No such preview of yours.", 404);
  const code = previewCodeFor(await getPreviewCode(userId));
  if (!code) return jsonError("Set an access code first — it stays closed until then.", 409);
  const value = createPreviewAccessCookie(Date.now(), code);
  if (!value) return jsonError("This server cannot sign the cookie.", 503);
  const secure = new URL(req.url).protocol === "https:";
  return jsonOk(
    {
      cookie: {
        name: PREVIEWS.cookie,
        value,
        maxAgeSeconds: Math.floor(PREVIEWS.cookieTtlMs / 1000),
      },
    },
    {
      headers: {
        "Set-Cookie": previewAccessSetCookie(value, PREVIEWS.routePrefix, secure),
        "Cache-Control": "no-store",
      },
    },
  );
}
