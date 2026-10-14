import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { createPreview } from "@/lib/previews/create";
import { MAX_ARCHIVE_BYTES } from "@/lib/previews/unpack";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiUserId } from "@/lib/session";

const Body = z.object({
  name: z.string().trim().min(1, "Name who the site is for.").max(80),
  about: z.string().trim().max(2000).optional(),
  /** The subdomain: <address>.orangecat.ch. Defaults to the name. */
  address: z.string().trim().max(48).optional(),
  /** The access code for all your previews; remembered once given. */
  code: z.string().trim().min(3, "A code needs at least 3 characters.").max(40).optional(),
});

/**
 * Start a preview for someone who is not a customer yet: a folder on the box,
 * a project without a repository, the widget, and a build. Returns the link to
 * send and the owner link that lets their notes start changes.
 */
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to build a preview.", 401);
  // JSON for "build it", multipart when a finished site comes along as a .zip.
  let raw: unknown;
  let archive: Uint8Array | undefined;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const field = (key: string) => {
      const value = form?.get(key);
      return typeof value === "string" && value.trim() ? value : undefined;
    };
    raw = {
      name: field("name"),
      about: field("about"),
      address: field("address"),
      code: field("code"),
    };
    const file = form?.get("archive");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_ARCHIVE_BYTES) {
        return jsonError("The archive is larger than 25 MB. Compress the images first.", 413);
      }
      archive = new Uint8Array(await file.arrayBuffer());
    }
  } else {
    raw = await req.json().catch(() => null);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Check the form.", 400);
  if (!checkRateLimit(`preview-create:${userId}`, 20, RATE_LIMIT_WINDOW_LONG_MS)) {
    return jsonError("That is a lot of previews in an hour. Try again a little later.", 429);
  }
  const result = await createPreview(userId, { ...parsed.data, archive });
  if (!result.ok) return jsonError(result.error, result.status);
  const { slug, projectId, previewUrl, ownerUrl, buildNote, addressNote, accessCode } = result;
  return jsonOk(
    { preview: { slug, projectId, previewUrl, ownerUrl, buildNote, addressNote, accessCode } },
    { status: 201 },
  );
}
