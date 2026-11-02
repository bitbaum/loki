import { headers } from "next/headers";

/**
 * The notify routes are for machines holding a Loki token (the box, OpenClaw,
 * scripts), never for a browser: accepting the session cookie would let any
 * page the owner has open post a notice to his phone (CSRF).
 */
export async function hasBearerToken(): Promise<boolean> {
  const auth = (await headers()).get("authorization") ?? "";
  return auth.startsWith("Bearer ");
}
