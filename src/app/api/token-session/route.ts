/**
 * POST /api/token-session — mint a link that opens a browser session with
 * an agent's `ck_` token (lib/auth/token-session.ts).
 *
 *   Authorization: Bearer ck_…        (a token; a browser session cannot mint)
 *   { "next": "/projects" }           (optional; a same-site path)
 *   → 201 { url, expiresAt, sessionTtlSeconds }
 *
 * The link opens once, within two minutes, and the session it opens ends
 * after an hour with the token's power. The token never appears in the link;
 * the link carries a random code whose hash is all the server keeps.
 */
import { NextRequest, NextResponse } from "next/server";
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";
import { findLiveAgentToken, mintTokenSessionLink } from "@/db/queries/token-sessions";
import { LINK_TTL_SECONDS, SESSION_TTL_SECONDS, safeNextPath } from "@/lib/auth/token-session";
import { siteUrl } from "@/lib/auth/shared/runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ck_") ? header.slice(7) : null;
  if (!bearer) {
    return NextResponse.json(
      { error: "Send your agent token: Authorization: Bearer ck_…" },
      { status: 401, headers: NO_STORE },
    );
  }
  const token = await findLiveAgentToken(bearer);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!sharedRuntimeEnabled()) {
    return NextResponse.json(
      { error: "Token sessions open on the AccountKit runtime; this server runs Auth.js." },
      { status: 501, headers: NO_STORE },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { next?: unknown };
  const nextPath = safeNextPath(body?.next);
  const { code, expiresAt } = await mintTokenSessionLink({
    userId: token.userId,
    agentTokenId: token.id,
    nextPath,
    ttlSeconds: LINK_TTL_SECONDS,
  });
  const url = new URL("/api/auth/loki/token-session", siteUrl());
  url.searchParams.set("code", code);
  return NextResponse.json(
    {
      url: url.toString(),
      next: nextPath,
      expiresAt: expiresAt.toISOString(),
      sessionTtlSeconds: SESSION_TTL_SECONDS,
    },
    { status: 201, headers: NO_STORE },
  );
}
