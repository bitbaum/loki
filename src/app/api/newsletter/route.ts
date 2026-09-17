import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { publicCorsHeaders } from "@/lib/api/public-cors";
import { subscribeToNewsletter } from "@/db/queries/newsletter-subscribers";
import { notifyNewsletterSignup } from "@/lib/newsletter/notify-signup";

// Public (pre-auth) endpoint — excluded from the auth middleware in
// src/proxy.ts. Idempotent by design, so the response never leaks whether an
// address was already subscribed.
//
// Also serves the studio site's /hire/ waitlist, which is a static page on
// another origin: a JSON POST always triggers a preflight, so this route
// answers OPTIONS and echoes an allowlisted origin (src/lib/api/public-cors.ts
// — an allowlist, not `*`, because there is no token here). A new row now
// announces itself (src/lib/newsletter/notify-signup.ts); capture with no
// notification is how the /hire/ promise would have been quietly broken.

const SubscribeBody = z.object({
  email: z.string().trim().email().max(254),
  // Capture surface: "thoughts-index", an essay slug, or "bitbaum-hire".
  source: z.string().trim().min(1).max(120),
});

/**
 * Apply the CORS headers to a response that already exists.
 *
 * Vary is APPENDED, never set: Next attaches its own Vary list (rsc,
 * next-router-*) to every response, and passing Vary in a `headers` init lost
 * to it — measured on the live endpoint, which answered the correct
 * Access-Control-Allow-Origin with no `Vary: Origin` beside it. A per-origin
 * ACAO without Vary is precisely the header a shared cache may hand to the
 * wrong origin. The unit test could not see this because it asserts what the
 * helper RETURNS, not what the framework puts on the wire.
 */
function withCors(res: NextResponse, cors: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(cors)) {
    if (key.toLowerCase() === "vary") res.headers.append("Vary", value);
    else res.headers.set(key, value);
  }
  return res;
}

export async function OPTIONS(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  return withCors(res, publicCorsHeaders(req.headers.get("origin")));
}

export async function POST(req: NextRequest) {
  const cors = publicCorsHeaders(req.headers.get("origin"));
  const ip = getClientIp(req);
  if (!checkRateLimit(`newsletter:${ip}`, 5, 60_000)) {
    // Built here rather than via jsonError: a cross-origin refusal the browser
    // cannot read is a refusal the visitor cannot be told about.
    return withCors(
      NextResponse.json({ error: "Too many requests — try again in a minute" }, { status: 429 }),
      cors,
    );
  }

  const dataOrResp = await readJsonBody(req, SubscribeBody);
  if (dataOrResp instanceof NextResponse) return withCors(dataOrResp, cors);

  const isNew = await subscribeToNewsletter(dataOrResp.email, dataOrResp.source);
  if (isNew) await notifyNewsletterSignup(dataOrResp.email, dataOrResp.source);
  return withCors(jsonOk({ subscribed: true }), cors);
}
