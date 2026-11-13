/**
 * GET /api/orangecat/shot/[token] — a picture a bot's browser took.
 *
 * The name is the permission (lib/bot-shots): 32 random hex characters,
 * a week at most. Nothing here lists, and a wrong or old name is a plain 404.
 */
import { NextResponse } from "next/server";
import { readShot } from "@/lib/bot-shots";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const bytes = await readShot(token.replace(/\.jpe?g$/i, ""));
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
