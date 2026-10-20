/**
 * GET/PATCH /api/settings/build-engine — what this account's builds run on.
 *
 * "own" (the default): the person's sign-in in their builder, or a key they
 * marked for building. Nothing counted. "loki": Loki's key within the
 * welcome builds and the plan's monthly builds; the box writes Loki's key
 * into their unit while any are left (scripts/write-tenant-engines.ts), and
 * a dispatch past the last one is refused with the way forward.
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { setBuildEngine } from "@/db/queries/users";
import { BUILD_ENGINE_CHOICES } from "@/db/schema/users";
import { resolveRunEngine } from "@/lib/build-engine/resolve";
import { LOKI_BUILD_ENGINE_KEY_VAR, WELCOME_BUILDS } from "@/config/welcome-changes";
import { PLAN_LIMITS } from "@/lib/plan";
import { getUserById } from "@/db/queries/users";

export const runtime = "nodejs";

async function view(userId: string) {
  const [user, resolved] = await Promise.all([getUserById(userId), resolveRunEngine(userId)]);
  const plan = user?.plan ?? "free";
  return {
    choice: user?.buildEngine ?? "own",
    // Whether this server has a Loki engine at all: the key is the app's.
    lokiAvailable: !!process.env[LOKI_BUILD_ENGINE_KEY_VAR]?.trim(),
    welcomeBuilds: WELCOME_BUILDS,
    planBuildsMonthly: PLAN_LIMITS.buildsMonthly[plan],
    welcomeLeft: resolved.allowance?.welcomeLeft ?? null,
    planLeft: resolved.allowance?.planLeft ?? null,
    exhausted: resolved.ok ? null : resolved.message,
  };
}

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  return jsonOk(await view(userId));
}

const Body = z.object({ choice: z.enum(BUILD_ENGINE_CHOICES) });

export async function PATCH(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  if (body.choice === "loki" && !process.env[LOKI_BUILD_ENGINE_KEY_VAR]?.trim())
    return jsonError("This server has no engine of Loki's to build on.", 409);
  await setBuildEngine(userId, body.choice);
  return jsonOk(await view(userId));
}
