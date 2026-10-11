import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { readUserBudget } from "@/lib/ai/budget";

/**
 * GET /api/ai/budget — how much AI this person has left, on every source they
 * can draw on, before they are refused.
 *
 * The capacity route beside this (`/api/ai/quota`) is the OPERATOR's view:
 * vendor counters for the whole box. This is the person's: their share of
 * the free pool today and how much of it has unlocked, what their own keys
 * spent, and what each free model's vendor last said — the numbers the gate
 * refuses on, shown before the refusal. Counts and sentences only; no key
 * ever leaves the server.
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  return jsonOk(await readUserBudget(userId));
}
