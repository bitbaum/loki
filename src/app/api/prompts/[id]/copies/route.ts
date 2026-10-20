// Extra identical copies of one saved prompt.
//
// DELETE /api/prompts/<id>/copies → soft-delete the caller's other rows with
//                                    the same name + words, keeping the newest.
//                                    Answers { ok, kept, removed }.
//
// Only ever called from the explicit "Remove N extra copies" button on a card
// that says how many copies it stands for — never as a side effect.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { removeIdenticalCopies } from "@/db/queries/prompts";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = await removeIdenticalCopies(userId, id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
