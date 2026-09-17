import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { listReporterFeedback } from "@/db/queries/site-feedback";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  return jsonOk({ feedback: await listReporterFeedback(userId) });
}
