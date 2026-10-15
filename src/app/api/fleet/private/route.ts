import { NextResponse, type NextRequest } from "next/server";
import { COMMISSION } from "@/config/commission";
import { PREVIEWS } from "@/config/previews";
import { getPreviewCode } from "@/db/queries/preview-code";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { loadFleetMap } from "@/lib/register/load-map";
import { privatePortfolio } from "@/lib/register/private-portfolio";
import {
  createPreviewAccessCookie,
  previewCodeFor,
  previewCodeMatches,
  verifyPreviewAccessCookie,
} from "@/lib/previews/access";

/**
 * POST /api/fleet/private — the studio's client work that is not public yet,
 * for the "Private projects" area on bitbaum.orangecat.ch.
 *
 * Opened by the same access code as the prospect previews (the operator's,
 * set in the app). Body: `{ code }` the first time, then `{ token }` — the
 * signed, expiring token returned with the list, so the visitor is not asked
 * again. Change the code and every token stops working.
 */
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": COMMISSION.studioOrigin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { code?: unknown; token?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 200) : "";
  const token = typeof body?.token === "string" ? body.token.slice(0, 200) : "";
  if (!code && !token) return reply({ error: "Enter the access code." }, 400);

  const owner = await getSelfImprovementTarget();
  if (!owner) return reply({ error: "Not available right now." }, 503);
  const configured = previewCodeFor(await getPreviewCode(owner.userId));
  if (!configured) return reply({ error: "Private projects are switched off." }, 404);

  if (code) {
    const allowed = checkRateLimit(
      `fleet-private:${getClientIp(req)}`,
      PREVIEWS.attemptsPerWindow,
      PREVIEWS.attemptWindowMs,
    );
    if (!allowed) return reply({ error: "Too many tries. Wait a few minutes." }, 429);
  }

  const ok = code
    ? previewCodeMatches(code, configured)
    : verifyPreviewAccessCookie(token, Date.now(), configured);
  if (!ok) {
    return reply(
      { error: code ? "That code is not right." : "Enter the code again.", expired: !code },
      401,
    );
  }

  const map = await loadFleetMap("operator");
  if (!map) return reply({ error: "Not available right now." }, 503);
  return reply({
    ok: true,
    projects: privatePortfolio(map),
    token: code ? createPreviewAccessCookie(Date.now(), configured) : token,
  });
}
