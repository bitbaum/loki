import { NextRequest } from "next/server";
import { z } from "zod";
import { readStudioBody } from "@/lib/studio/body";
import { studioOriginAllowed } from "@/lib/studio/access";
import {
  studioPreflight,
  studioRateAllowed,
  studioContext,
  studioResponse,
  studioError,
  studioFailure,
} from "@/lib/studio/http";
import { rotateStudioAccessByContact } from "@/db/queries/studio-requests";
import { mailStudioLink } from "@/lib/studio/link-mail";
export const OPTIONS = studioPreflight;

const Body = z
  .object({ email: z.email().max(200), company: z.string().max(200).default("") })
  .strict();

/**
 * "Send my link again." A visitor who lost the private link to a studio
 * request gives the address they gave us; every open request under it gets a
 * fresh key (the old link dies) and the links go to that address — and only
 * there. The answer is the same whether or not the address is known, so the
 * door tells a stranger nothing.
 */
export async function POST(request: NextRequest) {
  if (!studioOriginAllowed(request, true))
    return studioError(request, "Submit through the Bitbaum studio website.", 403);
  if (!studioRateAllowed(request, "recover", 3))
    return studioError(request, "Too many requests. Try again shortly.", 429);
  try {
    const parsed = Body.safeParse(await readStudioBody(request));
    if (!parsed.success) return studioError(request, "Enter the email address you gave us.", 400);
    const { token } = await studioContext();
    if (!parsed.data.company) {
      const rotated = await rotateStudioAccessByContact(token.userId, parsed.data.email);
      for (const r of rotated)
        mailStudioLink({
          to: parsed.data.email,
          id: r.id,
          accessKey: r.accessKey,
          kind: r.kind,
          fresh: true,
        });
    }
    return studioResponse(request, {
      sent: true,
      message: "If that address belongs to a request, a fresh link is on its way to it.",
    });
  } catch (error) {
    return studioFailure(request, error);
  }
}
