import { toNextJsHandler } from "better-auth/next-js";
import { guardAuthRequest } from "@/lib/auth/guard";
import { getAuth } from "@/lib/auth/server";

/**
 * better-auth's HTTP surface: sign-up, sign-in (password, magic link, passkey,
 * OIDC), 2FA, sessions, account linking. Every request passes the guard first:
 * 503 when this deployment has no account system yet, 429 when the caller has
 * asked too often. The handler is resolved per request so the build needs no
 * database and no secret.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return (await guardAuthRequest(request)) ?? toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return (await guardAuthRequest(request)) ?? toNextJsHandler(getAuth()).POST(request);
}
