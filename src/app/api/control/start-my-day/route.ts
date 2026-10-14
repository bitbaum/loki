import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getDayCatalog, saveDayPreferences } from "@/lib/start-my-day/catalog";
import { kickFleet, type FleetKickResult } from "@/lib/fleet-kick";
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
  const projects = resolveDaySelection(body.projectIds, await getDayCatalog(userId));
  if (!projects)
    return jsonError("The selection changed. Refresh and choose your projects again.", 400);
  if (projects.some((p) => !p.canStart))
    return jsonError("You have view-only access to a selected project.", 403);
  const groups = new Map<string, typeof projects>();
  for (const p of projects) groups.set(p.userId, [...(groups.get(p.userId) ?? []), p]);
  const results: FleetKickResult[] = [];
  const startedIds: string[] = [];
  for (const [ownerId, group] of groups) {
    const kick = () =>
      kickFleet(ownerId, {
        source: "start_my_day",
        projectKeys: group.map((p) => p.name),
        requireFleetOn: false,
      });
    // Shared work uses the owner's credentials, capacity and cross-tab lock.
    const result = await withDayStartLock(ownerId, kick);
    if (!result && results.length === 0)
      return jsonError(
        "This project's owner is already starting work. Check progress before retrying.",
        409,
      );
    if (!result) {
      results.push({
        ...results[0],
        kicked: 0,
        details: group.map((p) => ({
          projectKey: p.name,
          outcome: "skipped" as const,
          reason: "busy",
        })),
      });
      continue;
    }
    results.push(result);
    startedIds.push(
      ...group
        .filter((p) =>
          result.details.some((d) => d.projectKey === p.name && d.outcome === "kicked"),
        )
        .map((p) => p.id),
    );
  }
  const result = {
    ...results[0],
    kicked: results.reduce((n, r) => n + r.kicked, 0),
    details: results.flatMap((r) => r.details),
    ok: results.every((r) => r.ok),
  };
  return jsonOk({ result, startedIds });
}

const PreferencesBody = z.object({
  mainProjectIds: z.array(z.string().uuid()).max(200),
  labels: z.record(z.string().uuid(), z.string().trim().min(1).max(100)),
});

export async function PATCH(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, PreferencesBody);
  if (body instanceof NextResponse) return body;
  const available = new Set((await getDayCatalog(userId)).map((p) => p.id));
  if ([...body.mainProjectIds, ...Object.keys(body.labels)].some((id) => !available.has(id)))
    return jsonError("Project access changed. Refresh the list before saving.", 403);
  await saveDayPreferences(userId, { ...body, mainProjectIds: [...new Set(body.mainProjectIds)] });
  return jsonOk({ ok: true });
}
