import { authStatus, getAuth } from "./server";

type SessionUser = { id: string; role?: unknown };

/**
 * The signed-in person behind an API request, or the Response to send instead
 * (503 without an account system, 401 without a session). Every API route that
 * touches a person's data starts here.
 */
export async function requireUser(
  request: Request,
): Promise<{ user: SessionUser; response?: never } | { user?: never; response: Response }> {
  const noStore = { "Cache-Control": "no-store" };
  if (!authStatus().ready) {
    return {
      response: Response.json({ error: "accounts_unavailable" }, { status: 503, headers: noStore }),
    };
  }
  const session = await getAuth()
    .api.getSession({ headers: request.headers })
    .catch(() => null);
  if (!session) {
    return {
      response: Response.json({ error: "sign_in_required" }, { status: 401, headers: noStore }),
    };
  }
  return { user: session.user };
}
