/**
 * GET /api/sessions/<tab>/pending-approvals — the permission prompts the agent
 * in this session is waiting on (lib/approvals.ts). A person's session or the
 * account's own `ck_` token; every row is the caller's own run. Use `*` for
 * every session of the account.
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiActor } from "@/lib/session";
import { listPendingApprovals } from "@/db/queries/approvals";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tab: string }> }) {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tab: raw } = await params;
  const tab = decodeURIComponent(raw).trim();
  if (!tab || tab.length > 120)
    return NextResponse.json({ error: "tab required" }, { status: 400 });
  const approvals = await listPendingApprovals(actor.userId, tab === "*" ? null : tab);
  return NextResponse.json({ approvals }, { headers: { "Cache-Control": "no-store" } });
}
