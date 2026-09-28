/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for Loki's MCP endpoint.
 *
 * The first thing a connector UI reads after /api/mcp answers 401: it names
 * OrangeCat as the authorization server and lists the scopes to ask for. Public
 * by nature — it describes how to get a credential, so it cannot require one —
 * and excluded from the session middleware in src/proxy.ts for that reason.
 * The content is SSOT in src/config/mcp.ts.
 */
import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/config/mcp";
import { MCP_CORS_HEADERS, mcpPreflight } from "@/lib/mcp/http";

// Read at request time, not frozen into the build: LOKI_MCP_RESOURCE and the
// issuer come from the box's runtime env, and a prerendered copy would keep
// announcing whatever the build machine had.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { ...MCP_CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

export const OPTIONS = mcpPreflight;
