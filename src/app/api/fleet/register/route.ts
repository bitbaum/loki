import { NextResponse } from "next/server";
import { getUserProjects } from "@/db/queries/user-projects";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { readAppsConf } from "@/lib/register/apps-conf";
import { buildFleetRegister, summarize } from "@/lib/register/build";
import { registerInput } from "@/lib/register/project-input";
import { solonClaims } from "@/lib/register/solon";

/**
 * GET /api/fleet/register — the studio's projects, joined across every surface.
 *
 * PUBLIC on purpose. This is the register the bitbaum showcase, the public
 * footer and anyone else derive their "what do we have" from; a register that
 * needs a session is a register with a private copy on every consumer. Nothing
 * here is secret: repo names, public URLs, and whether a public profile exists.
 *
 * Scoped to the studio owner's projects (the same identity every hosted
 * dispatch runs for), not "all users" — Loki is multi-tenant in shape. Client
 * work appears only once the client agreed (src/lib/register/client-work.ts):
 * the builder's default audience is "public".
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await getSelfImprovementTarget();
  if (!owner) {
    return NextResponse.json({ error: "no owner resolved" }, { status: 503 });
  }
  const [projects, solon] = await Promise.all([getUserProjects(owner.userId), solonClaims()]);
  const rows = buildFleetRegister(projects.map(registerInput), readAppsConf(), solon.claims);
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      // `solonChecked: false` means Solon could not be reached; its column is
      // then "unknown", not "none" — a consumer must not render it as absent.
      solonChecked: solon.checked,
      summary: summarize(rows),
      rows,
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
