import { NextRequest, NextResponse } from "next/server";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { studioApplicationsForActor } from "@/db/queries/studio-requests";
import { getUserById } from "@/db/queries/users";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { resolveSessionUserId } from "@/lib/session";
import { STUDIO_SESSION_HEADERS } from "@/lib/studio/access";
import { studioSessionSummary } from "@/lib/studio/session-summary";
import { siteUrl } from "@/lib/auth/shared/runtime";

/**
 * GET /api/studio-session — who is looking at bitbaum.orangecat.ch.
 *
 * The studio site is static files. It has no accounts of its own and must not
 * grow any: a person's account is their Loki account (and through it their
 * OrangeCat one). So its header asks here, with the reader's own session
 * cookie, and gets a name, a handle, a picture and what that person can open:
 * their builder applications, or the studio's requests if they run it.
 *
 * Public on the proxy's list on purpose: signed out is an ANSWER here
 * (`signedIn: false` and where to sign in), and the proxy's own 401 carries no
 * CORS headers, which a browser reports as a network failure, not as "nobody
 * is signed in". The cookie session is the only credential read; a bearer
 * token is an agent's, and an agent is not a visitor of the studio site.
 *
 * Read-only, and readable by that one origin (lib/studio/access.ts).
 */
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: STUDIO_SESSION_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: STUDIO_SESSION_HEADERS });
}

export async function GET(request: NextRequest) {
  // Once per page a visitor opens; the site keeps the answer for the visit.
  if (!checkRateLimit(`studio:session:${getClientIp(request)}`, 240, RATE_LIMIT_WINDOW_SHORT_MS))
    return reply({ error: "Please retry shortly." }, 429);
  const to = request.nextUrl.searchParams.get("to");
  const userId = await resolveSessionUserId();
  const user = userId ? await getUserById(userId) : null;
  if (!user)
    return reply(
      studioSessionSummary({ user: null, owner: false, applications: null }, siteUrl(), to),
    );
  const [owner, applications] = await Promise.all([
    getSelfImprovementTarget().then((target) => target?.userId === user.id),
    user.orangecatActorId ? studioApplicationsForActor(user.orangecatActorId) : null,
  ]);
  return reply(
    studioSessionSummary(
      {
        user: { name: user.name, username: user.username, image: user.image },
        owner,
        applications,
      },
      siteUrl(),
      to,
    ),
  );
}
