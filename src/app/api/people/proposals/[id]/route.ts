import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePrivateApiAccess } from "@/lib/private-zone-api";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { approveAction, rejectAction, getActionById } from "@/db/queries/actions";
import { executeAction } from "@/lib/actions/execute-action";
import { recoverEventPayloadFromText } from "@/lib/actions/calendar-event";
import { isBookActionType } from "@/config/book";

const Body = z.object({
  decision: z.enum(["accept", "discard"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const action = await getActionById(access.userId, idOrResp);
  if (!action || !isBookActionType(action.type)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (dataOrResp.decision === "discard") {
    const [rejected] = await rejectAction(idOrResp, access.userId);
    if (!rejected) return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
    return NextResponse.json({ ok: true, status: rejected.status });
  }

  const [approved] = await approveAction(idOrResp, access.userId);
  if (!approved) return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
  const result = await executeAction(access.userId, approved, {
    recoverEvent: recoverEventPayloadFromText,
  });
  return NextResponse.json({ ok: result.executed, ...result });
}
