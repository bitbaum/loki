import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { isSiteOperator } from "@/db/queries/users";
import { BUILD_REQUESTS } from "@/config/build-requests";
import { decideBuildRequest } from "@/lib/build-requests/decide";

const Body = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({
    decision: z.literal("decline"),
    note: z.string().trim().max(BUILD_REQUESTS.noteMax).nullable().default(null),
  }),
]);

/**
 * The operator approves or declines a new account's build request
 * (config/build-requests). Operator only: approving spends the fleet's
 * builder, and that is exactly the decision the request was filed for.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in first.", 401);
  if (!(await isSiteOperator(userId))) return jsonError("Only the operator decides these.", 403);
  const { id } = await params;
  if (!isValidUuid(id)) return jsonError("No such request.", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Approve or decline.", 400);
  const result = await decideBuildRequest(userId, id, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({
    status: result.row.status,
    previewUrl: result.row.previewUrl,
    accessCode: result.row.accessCode,
  });
}
