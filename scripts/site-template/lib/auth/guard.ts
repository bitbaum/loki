import { authBucket, callerKey, limits, recipientKey, tooMany } from "@/lib/limits";
import { authStatus } from "./server";

/**
 * What stands in front of every /api/auth request: is there an account system
 * here at all, and has this caller asked too often.
 *
 * Returns a Response to send INSTEAD of handling the request, or null to go on.
 */
export async function guardAuthRequest(request: Request): Promise<Response | null> {
  const status = authStatus();
  if (!status.ready) {
    return Response.json(
      { error: "accounts_unavailable", reason: status.reason },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "") || "/";
  const bucket = request.method === "GET" ? "auth" : authBucket(path);
  const byCaller = limits[bucket].check(callerKey(request.headers, `auth-${bucket}`));
  if (!byCaller.allowed) return tooMany(byCaller);

  if (bucket === "mail") {
    const email = await recipientOf(request);
    if (email) {
      const byRecipient = limits.mailTo.check(recipientKey(email));
      if (!byRecipient.allowed) return tooMany(byRecipient);
    }
  }
  return null;
}

/** The address a mail-sending request would write to, read from a CLONE of its body. */
async function recipientOf(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();
    const email = (body as { email?: unknown; newEmail?: unknown }) ?? {};
    const value = typeof email.email === "string" ? email.email : email.newEmail;
    return typeof value === "string" && value.includes("@") ? value : null;
  } catch {
    return null;
  }
}
