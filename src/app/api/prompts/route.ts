// User-owned prompts — list + create.
//
// GET  /api/prompts              → all prompts visible to the caller
// POST /api/prompts              → create one (validated via CreatePromptBody).
//                                   The same name + words a second time
//                                   creates nothing: it answers 200 with the
//                                   prompt already saved and `existing: true`.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readJsonBody } from "@/lib/api/route-helpers";
import {
  CreatePromptBody,
  createPrompt,
  findIdenticalPrompt,
  listPromptsForUser,
} from "@/db/queries/prompts";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listPromptsForUser(userId);
  return NextResponse.json({ prompts: rows });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await readJsonBody(req, CreatePromptBody);
  if (parsed instanceof NextResponse) return parsed;
  try {
    const existing = await findIdenticalPrompt(userId, parsed.name, parsed.body);
    if (existing) return NextResponse.json({ prompt: existing, existing: true });
    const row = await createPrompt(userId, parsed);
    return NextResponse.json({ prompt: row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
