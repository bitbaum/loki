import { NextRequest, NextResponse } from "next/server";
import { getHumanTask } from "@/db/queries/human-tasks";
import { readIdParam } from "@/lib/api/route-helpers";
import { requirePrivateApiAccess } from "@/lib/private-zone-api";
import { projectCrewWork } from "@/lib/work-orders/crew-projection";

export const dynamic = "force-dynamic";

/**
 * A PRIVATE, read-only projection. It is not an execution endpoint and cannot
 * mint consent, a spend grant, or a robotic command. Crew stays authoritative.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;

  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  // Owner-scoped in the query, not a client-provided identity.
  const task = await getHumanTask(access.userId, idOrResp);
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // No share token, internal contact book notes, private timeline text or
  // OrangeCat payout pointer is copied into the cross-product projection.
  return NextResponse.json(
    { ok: true, projection: projectCrewWork(task) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
