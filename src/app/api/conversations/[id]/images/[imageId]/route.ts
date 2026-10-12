import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { getConversationImage } from "@/db/queries/conversations";

/**
 * One picture a person put into a chat (schema/conversation-images.ts), for
 * the <img> in their message bubble. Only its owner gets the bytes; anything
 * else is a 404, so the URL says nothing about whether the image exists.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const { id, imageId } = await params;
  if (!isValidUuid(id) || !isValidUuid(imageId)) return jsonError("Not found", 404);

  const image = await getConversationImage(userId, id, imageId);
  if (!image || !/^image\/(png|jpeg|jpg|gif|webp)$/i.test(image.mimeType))
    return jsonError("Not found", 404);

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      // Owner-only, and a stored picture never changes.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
