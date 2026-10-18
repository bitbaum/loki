import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { getApiUserId } from "@/lib/session";

/**
 * Is the signed-in person the studio owner — the one person who may see the
 * studio's private client work? Shared by the private list and its pictures,
 * so the two can never disagree about who that is.
 */
export async function studioOwnerCheck(): Promise<
  { ok: true; userId: string } | { ok: false; status: 401 | 403 | 503; error: string }
> {
  const userId = await getApiUserId();
  if (!userId) return { ok: false, status: 401, error: "Sign in to Loki to see private projects." };
  const owner = await getSelfImprovementTarget();
  if (!owner) return { ok: false, status: 503, error: "Not available right now." };
  if (owner.userId !== userId)
    return { ok: false, status: 403, error: "Only the studio owner can see these." };
  return { ok: true, userId };
}
