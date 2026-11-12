/**
 * POST /api/sessions/<tab>/approvals/<id> { decision } — answer one permission
 * prompt from Loki: "allow_once", "allow_always" or "deny" (lib/approvals.ts).
 * A person's session or the account's own `ck_` token. The keys go to the
 * agent's terminal, and the answer is recorded on the run: who, how, when.
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiActor } from "@/lib/session";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { answerApproval } from "@/db/queries/approvals";
import { APPROVAL_DECISIONS } from "@/lib/approvals";

const Body = z.object({ decision: z.enum(APPROVAL_DECISIONS) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tab: string; id: string }> },
) {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const { tab, id } = await params;
  const result = await answerApproval({
    userId: actor.userId,
    approvalId: decodeURIComponent(id),
    decision: body.decision,
    tab: decodeURIComponent(tab),
    answeredBy: { userId: actor.userId, via: actor.via },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    decision: result.decision,
    approval: result.approval,
  });
}
