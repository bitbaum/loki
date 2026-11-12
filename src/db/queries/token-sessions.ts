import { createHash, randomBytes } from "crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentTokens, tokenSessions } from "@/db/schema";

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

/** A live `ck_` token's id and user, or null. Does not touch last_used_at. */
export async function findLiveAgentToken(
  token: string,
): Promise<{ id: string; userId: string } | null> {
  const [row] = await db
    .select({ id: agentTokens.id, userId: agentTokens.userId })
    .from(agentTokens)
    .where(
      and(
        eq(agentTokens.token, token),
        or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Mint a single-use link code for a token. The plaintext code is returned once and never stored. */
export async function mintTokenSessionLink(input: {
  userId: string;
  agentTokenId: string;
  nextPath: string;
  ttlSeconds: number;
}): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  await db.insert(tokenSessions).values({
    codeHash: hashCode(code),
    userId: input.userId,
    agentTokenId: input.agentTokenId,
    nextPath: input.nextPath,
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Open a link: exactly once, before it expires, while its token still lives.
 * The update is the claim, so two opens of one link cannot both succeed.
 */
export async function consumeTokenSessionLink(
  code: string,
): Promise<{ id: string; userId: string; nextPath: string } | null> {
  if (!code) return null;
  const [row] = await db
    .update(tokenSessions)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(tokenSessions.codeHash, hashCode(code)),
        isNull(tokenSessions.usedAt),
        gt(tokenSessions.expiresAt, new Date()),
        sql`EXISTS (SELECT 1 FROM agent_tokens t WHERE t.id = ${tokenSessions.agentTokenId}
                    AND (t.expires_at IS NULL OR t.expires_at > now()))`,
      ),
    )
    .returning({
      id: tokenSessions.id,
      userId: tokenSessions.userId,
      nextPath: tokenSessions.nextPath,
    });
  return row ?? null;
}

/** Record which AccountKit session a link opened. */
export async function bindTokenSession(id: string, sessionId: string): Promise<void> {
  await db.update(tokenSessions).set({ sessionId }).where(eq(tokenSessions.id, id));
}

/**
 * Whether a session was opened with a token, and whether that token still
 * lives. `null`: an ordinary sign-in. `{ live: false }`: the token was revoked
 * or expired, so the session must read as signed out.
 */
export async function tokenSessionState(sessionId: string): Promise<{ live: boolean } | null> {
  const [row] = await db
    .select({ tokenId: agentTokens.id, tokenExpiresAt: agentTokens.expiresAt })
    .from(tokenSessions)
    .leftJoin(agentTokens, eq(agentTokens.id, tokenSessions.agentTokenId))
    .where(eq(tokenSessions.sessionId, sessionId))
    .limit(1);
  if (!row) return null;
  const live = Boolean(row.tokenId) && (!row.tokenExpiresAt || row.tokenExpiresAt > new Date());
  return { live };
}
