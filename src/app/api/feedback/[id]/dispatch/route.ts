import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { implementFeedback } from "@/lib/feedback/implement";

const DispatchBody = z.object({
  note: z.string().trim().max(500).optional(),
  /**
   * Switch provider and retry, in one tap.
   *
   * The whole point of the field is that it PERSISTS: a retry that ran on a
   * different agent but left `agentPref` pointing at the one that just hit a
   * rate limit sent the next dispatch straight back into the wall, and the
   * operator had to find the preference in project settings to make it stick.
   * So this writes the project's preference and then dispatches on it — one
   * decision recorded once, in the place every other dispatch path reads.
   */
  agent: z.string().trim().max(40).optional(),
});

/** One-click Implement. The work is implementFeedback (lib/feedback/implement.ts). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, DispatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { status, body } = await implementFeedback(userId, idOrResp, {
    note: dataOrResp.note || undefined,
    agent: dataOrResp.agent,
  });
  return NextResponse.json(body, { status });
}
