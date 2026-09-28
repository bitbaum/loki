/**
 * Loki's MCP endpoint — AI apps (claude.ai and ChatGPT connectors, Claude Code,
 * Cursor) message Loki here and have it act. Streamable HTTP, stateless: one
 * POST, one complete JSON answer. See docs/development/mcp.md.
 *
 * Thin by design. The route authenticates (resolveMcpCaller — an agent token or
 * an OrangeCat access token minted for this resource), and hands the body to
 * the protocol module with the real services. Excluded from the session
 * middleware in src/proxy.ts because the connector flow STARTS with an
 * unauthenticated POST whose 401 challenge is how the client finds OrangeCat.
 */
import { NextRequest } from "next/server";
import { authFailureReply, resolveMcpCaller } from "@/lib/mcp/auth";
import { handleMcpPost, isAcceptableProtocolHeader } from "@/lib/mcp/server";
import { lokiMcpServices } from "@/lib/mcp/services";
import { MCP_CORS_HEADERS, mcpPreflight, mcpReply } from "@/lib/mcp/http";
import { denyDemoInHandler } from "@/lib/demo-guard";

/**
 * The largest body read. A JSON-RPC call here is a few kilobytes — the longest
 * argument is a 4000-character message — so anything near this is not a call.
 */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const auth = await resolveMcpCaller(req);
  if (!auth.ok) {
    const { status, body, headers } = authFailureReply(auth);
    return mcpReply(status, body, headers);
  }

  // Matcher-excluded path, so the demo gate lives here — see
  // DEMO_HANDLER_ENFORCED in config/demo.ts.
  const demoDenied = await denyDemoInHandler(auth.caller.userId, "dispatch");
  if (demoDenied) {
    for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) demoDenied.headers.set(k, v);
    return demoDenied;
  }

  if (!isAcceptableProtocolHeader(req.headers.get("mcp-protocol-version"))) {
    return mcpReply(400, { error: "Unsupported MCP-Protocol-Version" });
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return mcpReply(413, { error: "Request body too large" });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return mcpReply(413, { error: "Request body too large" });

  const { status, body } = await handleMcpPost(raw, {
    caller: auth.caller,
    services: lokiMcpServices,
    version: process.env.npm_package_version,
  });
  return mcpReply(status, body);
}

/** Stateless: there is no server-to-client stream to open and no session to end. */
function methodNotAllowed() {
  return mcpReply(
    405,
    { error: "Method not allowed — POST JSON-RPC to this endpoint" },
    {
      Allow: "POST, OPTIONS",
    },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = mcpPreflight;
