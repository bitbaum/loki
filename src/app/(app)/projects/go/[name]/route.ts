import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/email";
import { getSessionUserId } from "@/lib/session";
import { getUserProjects } from "@/db/queries/user-projects";
import { projectGoTarget } from "@/lib/project-go";

/**
 * GET /projects/go/<name>?tab=people — open one of your own projects by its
 * name (lib/project-go). Signed out, the proxy sends the person through
 * sign-in and back here. No match lands on the project list, never an error.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const userId = await getSessionUserId();
  const { name } = await params;
  const target = userId
    ? projectGoTarget(
        await getUserProjects(userId).catch(() => []),
        decodeURIComponent(name),
        req.nextUrl.searchParams.get("tab"),
      )
    : "/projects";
  // The public origin, never req.nextUrl.origin: behind Caddy that is the
  // standalone server's own localhost:PORT, and the browser was sent there
  // (ERR_CONNECTION_REFUSED on the live site, 2026-10-17).
  return NextResponse.redirect(`${appUrl()}${target}`, 307);
}
