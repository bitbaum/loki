/**
 * The shapes the MCP server passes between its layers.
 *
 * Kept type-only so the dispatcher and the tools can be loaded — and tested —
 * without a database: the real services (lib/mcp/services.ts) are the only
 * module here that touches @/db, and only the route imports them.
 */
import type { McpScope } from "@/config/mcp";
import type { AskLokiResult } from "@/lib/loki-core";
import type { InjectResult } from "@/lib/inject-core";
import type { DecideActionOutcome } from "@/lib/actions/decide-action";
import type { EnqueueReport } from "@/lib/actions/enqueue-report";

/** Who is calling, and what they were granted. */
export type McpCaller = {
  /**
   * The Loki user the credential resolves to. Null when an OrangeCat token is
   * valid but no Loki account carries that actor yet — the caller may still
   * initialize and list tools, and every tool answers with how to link.
   */
  userId: string | null;
  scopes: ReadonlySet<McpScope>;
  via: "agent-token" | "orangecat";
  /** The OAuth client that holds the token (OrangeCat tokens only). */
  clientId?: string | null;
};

export type PendingApproval = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  reasoning: string | null;
  createdAt: Date | string | null;
  expiresAt: Date | string | null;
};

export type ProjectSummary = {
  name: string;
  description: string | null;
  liveUrl: string | null;
  /** "local" = the owner's machine via Fleet Runner; null = the cloud builder. */
  builderPref: string | null;
  lastDispatchAt: string | null;
};

export type BookRequest = {
  title: string;
  start: string;
  end?: string;
  location?: string;
};

/**
 * Everything a tool may do to Loki — each one a call into the SAME function
 * the HTTP route for that action calls, never a re-implementation and never a
 * request to Loki's own API.
 */
export type McpServices = {
  ask(
    userId: string,
    message: string,
    opts: { sessionKey: string; readOnly: boolean },
  ): Promise<AskLokiResult>;
  pendingApprovals(userId: string): Promise<PendingApproval[]>;
  decide(
    userId: string,
    actionId: string,
    decision: "approve" | "reject",
    extra: { reason?: string; meta: Record<string, unknown> },
  ): Promise<DecideActionOutcome>;
  dispatch(userId: string, project: string, task: string): Promise<InjectResult>;
  book(userId: string, request: BookRequest): Promise<EnqueueReport>;
  projects(userId: string): Promise<ProjectSummary[]>;
};
