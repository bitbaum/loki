/**
 * Turn a message's attachments into text a terminal agent can read, without
 * dispatching anything.
 *
 * The conversation view writes straight into the live Claude session (a
 * bracketed paste, like typing), so it cannot go through tab-inject — that
 * wraps the words in a fresh task with project context, which is right for
 * starting work and wrong for the next line of a conversation. It still needs
 * the SAME folding every dispatch route uses (lib/composer-attachments): a
 * screenshot is described by the vision chain, a text file is inlined. This
 * route is that fold and nothing else; the client pastes what comes back.
 */
import { NextRequest, NextResponse } from "next/server";
import { jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { AttachmentsField, foldAttachmentsIntoPrompt } from "@/lib/composer-attachments";
import { getApiUserId } from "@/lib/session";

const Body = z.object({
  text: z.string().max(4000),
  attachments: AttachmentsField,
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { text, attachments } = dataOrResp;
  return jsonOk({ prompt: await foldAttachmentsIntoPrompt(text, attachments) });
}
