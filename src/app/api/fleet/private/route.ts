import { NextResponse } from "next/server";
import { COMMISSION } from "@/config/commission";
import { loadFleetMap } from "@/lib/register/load-map";
import { privatePortfolio } from "@/lib/register/private-portfolio";
import { studioOwnerCheck } from "@/lib/register/studio-owner";

/**
 * GET /api/fleet/private — the studio's client work that is not public yet,
 * for the "Private projects" area on bitbaum.orangecat.ch.
 *
 * Only the studio owner, signed in to Loki, gets the list. It used to open
 * with the preview access code, but that code is the one clients are given
 * for their own preview — so any client could have read every other client's
 * project. A signed-in session is the only key that belongs to the owner
 * alone. bitbaum.orangecat.ch and loki.orangecat.ch are the same site, so
 * the page's `credentials: "include"` fetch carries the Loki session cookie.
 */
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": COMMISSION.studioOrigin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  Vary: "Origin, Cookie",
};

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  // Private client work is the studio owner's to show, and nobody else's.
  const owner = await studioOwnerCheck();
  if (!owner.ok) return reply({ error: owner.error }, owner.status);

  const map = await loadFleetMap("operator");
  if (!map) return reply({ error: "Not available right now." }, 503);
  return reply({ ok: true, projects: privatePortfolio(map) });
}
