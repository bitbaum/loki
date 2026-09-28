/**
 * The MCP protocol itself — JSON-RPC 2.0 over Streamable HTTP, stateless.
 *
 * Hand-rolled because the surface Loki needs is five methods and the SDK would
 * bring a transport, a session store and a dependency this repo cannot install
 * reviewably. Stateless on purpose: every POST carries its own bearer token and
 * is answered in full, so there is no Mcp-Session-Id to issue, expire or leak,
 * and any instance behind Caddy can answer any request.
 *
 * Pure: the caller and the services arrive as arguments, so the unit suite
 * drives every branch without a database, a network or a Next.js request.
 */
import { APP_NAME } from "@/config/brand";
import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_INSTRUCTIONS } from "@/config/mcp";
import { callTool, listTools } from "@/lib/mcp/tools";
import type { McpCaller, McpServices } from "@/lib/mcp/types";

export const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type JsonRpcId = string | number | null;

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

/** What the route writes: a status, and a JSON body or none (202 Accepted). */
export type McpHttpReply = { status: number; body: unknown };

export type McpContext = { caller: McpCaller; services: McpServices; version?: string };

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** Echo the client's revision when we speak it; otherwise offer our newest. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
}

/**
 * After initialize, a client sends MCP-Protocol-Version on every request. An
 * absent header is allowed (the spec says assume 2025-03-26); a revision we do
 * not speak is a 400, not a guess.
 */
export function isAcceptableProtocolHeader(value: string | null): boolean {
  return value === null || (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One message in; a response, or null when the message expects none. */
async function handleMessage(msg: unknown, ctx: McpContext): Promise<JsonRpcResponse | null> {
  if (!isObject(msg) || msg.jsonrpc !== "2.0") {
    return fail(null, JSONRPC.INVALID_REQUEST, "Invalid JSON-RPC 2.0 message");
  }
  const hasId = "id" in msg;
  const id = (hasId ? msg.id : null) as JsonRpcId;
  if (hasId && id !== null && typeof id !== "string" && typeof id !== "number") {
    return fail(null, JSONRPC.INVALID_REQUEST, "id must be a string or number");
  }

  // A response to something we asked (we never ask), or a notification: accept, answer nothing.
  if (typeof msg.method !== "string") {
    return "result" in msg || "error" in msg
      ? null
      : fail(id, JSONRPC.INVALID_REQUEST, "method is required");
  }
  if (!hasId) return null;

  const params = isObject(msg.params) ? msg.params : {};

  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "loki", title: APP_NAME, version: ctx.version ?? "0.1.0" },
        instructions: MCP_SERVER_INSTRUCTIONS,
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listTools() });
    case "tools/call": {
      if (typeof params.name !== "string") {
        return fail(id, JSONRPC.INVALID_PARAMS, "params.name is required");
      }
      const result = await callTool(params.name, params.arguments, ctx.caller, ctx.services);
      return result === null
        ? fail(id, JSONRPC.INVALID_PARAMS, `Unknown tool: ${params.name}`)
        : ok(id, result);
    }
    default:
      return fail(id, JSONRPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

/**
 * Batches were dropped from the 2025-06-18 revision and are kept here only for
 * older clients. The cap is what stops one POST from fanning out into dozens
 * of model turns at once — each tool call is answered in parallel.
 */
const MAX_BATCH = 10;

/**
 * The whole POST body in, the whole HTTP reply out. A body of only
 * notifications and responses is 202 with nothing to read; a batch answers with
 * the array of the responses it produced.
 */
export async function handleMcpPost(raw: string, ctx: McpContext): Promise<McpHttpReply> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: 400, body: fail(null, JSONRPC.PARSE_ERROR, "Parse error") };
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0 || payload.length > MAX_BATCH) {
      return {
        status: 400,
        body: fail(null, JSONRPC.INVALID_REQUEST, `A batch holds 1 to ${MAX_BATCH} messages`),
      };
    }
    const replies = (await Promise.all(payload.map((m) => handleMessage(m, ctx)))).filter(
      (r): r is JsonRpcResponse => r !== null,
    );
    return replies.length ? { status: 200, body: replies } : { status: 202, body: null };
  }

  const reply = await handleMessage(payload, ctx);
  return reply ? { status: 200, body: reply } : { status: 202, body: null };
}
