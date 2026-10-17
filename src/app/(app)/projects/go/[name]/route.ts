import { NextRequest, NextResponse } from "next/server";
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
  return NextResponse.redirect(new URL(target, req.nextUrl.origin), 307);
}
