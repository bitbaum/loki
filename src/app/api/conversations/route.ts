import { type NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import {
  listConversations,
  createConversation,
  DEFAULT_CONVERSATION_TITLE,
} from "@/db/queries/conversations";

const CreateBody = z.object({
  // Title is optional — a fresh thread starts with the placeholder and is
  // auto-titled from its first message (see messages route).
  title: z.string().trim().min(1).max(200).default(DEFAULT_CONVERSATION_TITLE),
  projectKeys: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  // A temporary chat: never listed, gone when the person leaves it.
  ephemeral: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectsParam = req.nextUrl.searchParams.get("projects");
  const projectKeys = projectsParam
    ? projectsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const conversations = await listConversations(userId, { projectKeys });
  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, CreateBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const conversation = await createConversation(userId, dataOrResp);
  return NextResponse.json({ conversation }, { status: 201 });
}
