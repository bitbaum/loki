import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { COMMISSION } from "@/config/commission";
import { CONSULT } from "@/config/site-consult";
import { consultSite } from "@/lib/site-consult/consult-site";

const Body = z.object({ website: z.string().trim().min(1).max(COMMISSION.maxWebsite) });

/**
 * The free consultation on /change: one public page read, judged by rules.
 * Public on purpose — it is the first thing a stranger sees, before any
 * account — so it spends no AI, reads exactly one page through the SSRF
 * guard, is rate-limited per visitor, and returns findings, never the page.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Name the website to look at.", 400);
  if (
    !checkRateLimit(
      `site-consult:${getClientIp(req)}`,
      CONSULT.rateLimit,
      RATE_LIMIT_WINDOW_LONG_MS,
    )
  )
    return jsonError("That is a lot of checks in an hour. Try again a little later.", 429);
  const result = await consultSite(parsed.data.website);
  if (!result.ok) return jsonError(result.reason, 422);
  return jsonOk({ consultation: result.consultation });
}
