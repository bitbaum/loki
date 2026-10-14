import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getUserProjects } from "@/db/queries/user-projects";
import { kickFleet } from "@/lib/fleet-kick";
import { MAX_CONCURRENT_BUILDING } from "@/lib/constants/control";
import { loadDayPlan } from "@/lib/start-my-day/load";
import { resolveDaySelection } from "@/lib/start-my-day/rank";
import { withDayStartLock } from "@/lib/start-my-day/lock";

const Body = z.object({
  projectIds: z.array(z.string().uuid()).min(1).max(MAX_CONCURRENT_BUILDING),
});

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  try {
    return jsonOk(await loadDayPlan(userId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError("Could not check recent work. Try again or open Control.", 503);
  }
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  // The lock survives multiple browser tabs and server workers. Try, never
  // wait: duplicate presses must not accumulate a second batch behind this one.
  const response = await withDayStartLock(userId, async () => {
    const projects = resolveDaySelection(body.projectIds, await getUserProjects(userId));
    if (!projects)
      return jsonError("The selection changed. Refresh and choose your projects again.", 400);
    // Names are resolved from owned, active IDs here, never trusted from the
    // browser. Fleet kick rechecks pauses, busy runs, pending work and capacity.
    const result = await kickFleet(userId, {
      source: "start_my_day",
      projectKeys: projects.map((p) => p.name),
      requireFleetOn: false,
    });
    return jsonOk({ result });
  });
  return response ?? jsonError("Already starting your projects. Check Control for progress.", 409);
}
