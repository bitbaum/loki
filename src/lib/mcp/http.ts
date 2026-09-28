/**
 * HTTP framing for the MCP endpoint and its discovery document.
 *
 * CORS is wide open, and that is safe here in a way it is not for the cookie
 * routes: /api/mcp authenticates ONLY by an explicit Authorization header,
 * never by cookie, so a page on another origin gains nothing a script with the
 * token would not already have. Browser-based MCP clients (the connector
 * inspectors, web IDEs) need the preflight to pass, and they need to READ the
 * WWW-Authenticate challenge — hence the expose header.
 */
import { NextResponse } from "next/server";

export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

/** A JSON reply with the CORS headers; `null` body means 202-style "nothing to read". */
export function mcpReply(status: number, body: unknown, headers?: Record<string, string>) {
  return body === null
    ? new NextResponse(null, { status, headers: { ...MCP_CORS_HEADERS, ...headers } })
    : NextResponse.json(body, { status, headers: { ...MCP_CORS_HEADERS, ...headers } });
}

export function mcpPreflight() {
  return new NextResponse(null, { status: 204, headers: MCP_CORS_HEADERS });
}
