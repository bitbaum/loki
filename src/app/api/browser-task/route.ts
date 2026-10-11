import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import {
  BROWSER_RECIPE_IDS,
  resolveBrowserTask,
  type BrowserRecipeId,
} from "@/config/browser-tasks";
import { enqueueBrowserTaskCommand } from "@/db/queries/pending-commands";

/**
 * POST { recipe, params } — "send it to my computer": queue the form for
 * Fleet Runner's browser window (config/browser-tasks.ts). The /fill page
 * calls this when the device in hand cannot fill it, and Fleet Runner's own
 * window calls it to fill right there.
 */
const Body = z.object({
  recipe: z.enum(BROWSER_RECIPE_IDS as [string, ...string[]]),
  params: z.record(z.string(), z.string().max(200)),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const task = resolveBrowserTask(body.recipe, body.params);
  if (!task) return jsonError("Those details don't fit this form", 400);
  const commandId = await enqueueBrowserTaskCommand(userId, {
    recipe: body.recipe as BrowserRecipeId,
    params: body.params,
    channel: "local",
  });
  return jsonOk({ commandId, title: task.title, button: task.handoff.button });
}
