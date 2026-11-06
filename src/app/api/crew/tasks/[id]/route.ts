import { NextRequest, NextResponse } from "next/server";
import { PatchHumanTaskBody } from "@/config/crew";
import { isActorCapabilityError } from "@/config/actors";
import {
  deleteHumanTask,
  getHumanTask,
  isTaskTransitionError,
  isTaskShareError,
  patchHumanTask,
} from "@/db/queries/human-tasks";
import { jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { requirePrivateApiAccess } from "@/lib/private-zone-api";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const task = await getHumanTask(access.userId, idOrResp);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return jsonOk({ task });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, PatchHumanTaskBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  try {
    const task = await patchHumanTask(access.userId, idOrResp, dataOrResp);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return jsonOk({ task });
  } catch (e: unknown) {
    // 409, not 400: the request was well-formed, the assignment just is not
    // somewhere that move is legal — usually because the assignee answered first.
    if (isTaskTransitionError(e) || isTaskShareError(e)) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (isActorCapabilityError(e)) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const deleted = await deleteHumanTask(access.userId, idOrResp);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return jsonOk();
}
