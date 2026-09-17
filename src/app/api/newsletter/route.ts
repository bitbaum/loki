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

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: publicCorsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: NextRequest) {
  const cors = publicCorsHeaders(req.headers.get("origin"));
  const ip = getClientIp(req);
  if (!checkRateLimit(`newsletter:${ip}`, 5, 60_000)) {
    // Built here rather than via jsonError: a cross-origin refusal the browser
    // cannot read is a refusal the visitor cannot be told about.
    return NextResponse.json(
      { error: "Too many requests — try again in a minute" },
      { status: 429, headers: cors },
    );
  }

  const dataOrResp = await readJsonBody(req, SubscribeBody);
  if (dataOrResp instanceof NextResponse) {
    for (const [k, v] of Object.entries(cors)) dataOrResp.headers.set(k, v);
    return dataOrResp;
  }

  const isNew = await subscribeToNewsletter(dataOrResp.email, dataOrResp.source);
  if (isNew) await notifyNewsletterSignup(dataOrResp.email, dataOrResp.source);
  return jsonOk({ subscribed: true }, { headers: cors });
}
