import { getApiUserId } from "@/lib/session";
import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { listStudioRequests } from "@/db/queries/studio-requests";
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  return jsonOk(
    { requests: await listStudioRequests(userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
