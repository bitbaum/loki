import { createHmac, timingSafeEqual } from "node:crypto";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";

/**
 * Proof that a note was filed by Loki's own reviewer or synthesizer.
 *
 * Both file through the public widget API, like a visitor, and they used to
 * say who they were with a plain `"source": "ai_review"`. Anyone holding the
 * page's public token could say the same: their note then skipped the owner's
 * notification and was labelled "Loki's own finding" in the inbox. The server
 * now decides. The prompt that starts a review carries this pass; a note
 * without a valid one is a visitor's, whatever it claims.
 *
 * Scoped to one project and one source, and short-lived: long enough for a
 * queued night run to reach the builder, not long enough to be worth copying.
 */

export const AGENT_SOURCES = [FEEDBACK_SOURCE.AI_REVIEW, FEEDBACK_SOURCE.SYNTHESIZER] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

const AGENT_PASS_TTL_MS = 48 * 60 * 60 * 1000;

function signature(payload: string): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for agent passes");
  // Domain-separated from the owner pass and the claim token (same secret).
  return createHmac("sha256", secret).update(`feedback-agent:${payload}`).digest("base64url");
}

export function createAgentPass(projectId: string, source: AgentSource, now = Date.now()): string {
  const payload = `${projectId}.${source}.${now + AGENT_PASS_TTL_MS}`;
  return `${payload}.${signature(payload)}`;
}

/** The source the pass proves for THIS project, or null. */
export function verifyAgentPass(
  pass: string | null | undefined,
  projectId: string,
  now = Date.now(),
): AgentSource | null {
  if (!pass) return null;
  const [passProject, source, expiresRaw, supplied] = pass.split(".");
  if (passProject !== projectId || !source || !expiresRaw || !supplied) return null;
  if (!(AGENT_SOURCES as readonly string[]).includes(source)) return null;
  if (!/^\d+$/.test(expiresRaw) || Number(expiresRaw) < now) return null;
  const a = Buffer.from(supplied);
  const b = Buffer.from(signature(`${passProject}.${source}.${expiresRaw}`));
  return a.length === b.length && timingSafeEqual(a, b) ? (source as AgentSource) : null;
}
