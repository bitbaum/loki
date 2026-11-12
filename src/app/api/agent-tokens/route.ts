import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { createAgentToken, listAgentTokens, deleteAgentToken } from "@/db/queries/agent-tokens";
import { getOwnerOrgId } from "@/db/queries/orgs";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { AGENT_TOKEN_KINDS } from "@/db/schema/agent-tokens";

const CreateBody = z.object({
  label: z.string().trim().min(1).max(80),
  /** "agent": drives sessions but may not act as a builder (claim commands,
   *  post screens, transcript, state or progress). Default "runner", which is
   *  what every token was before the kind existed — a builder's pairing needs
   *  it, and an older client that sends no kind keeps working. */
  kind: z.enum(AGENT_TOKEN_KINDS).optional(),
});

const DeleteBody = z.object({
  id: z.string().uuid(),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tokens = await listAgentTokens(userId);
  // Never expose the token value in list — only show metadata. Surface a short
  // prefix (industry convention; GitHub PATs do the same) so the user can match
  // a row here to the ck_… string in their daemon.env / .env.local and revoke
  // the right one without guessing.
  const safe = tokens.map(({ token, ...rest }) => ({
    ...rest,
    prefix: token.slice(0, 12) + "…",
  }));
  return NextResponse.json({ tokens: safe });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, CreateBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { label, kind } = dataOrResp;

  const orgId = await getOwnerOrgId(userId);
  const { token, record } = await createAgentToken(userId, label, orgId, kind ?? "runner");

  // Return the plaintext token exactly once — caller must store it. Also send
  // the prefix so the client can optimistically render the new row in the list
  // without a refetch.
  return NextResponse.json({
    token,
    id: record.id,
    label: record.label,
    kind: record.kind,
    createdAt: record.createdAt,
    prefix: token.slice(0, 12) + "…",
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, DeleteBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  await deleteAgentToken(dataOrResp.id, userId);
  return NextResponse.json({ ok: true });
}
