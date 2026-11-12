/**
 * The AccountKit side of a token-opened session (lib/auth/token-session.ts).
 *
 * - GET /api/auth/loki/token-session?code=… opens a link minted by
 *   POST /api/token-session: once, before it expires, while its token lives.
 *   The session it creates ends after SESSION_TTL_SECONDS and is never
 *   refreshed (the "don't remember me" cookie), and it is recorded as the
 *   token's BEFORE its cookie is set, so it can never exist unmarked.
 * - Every other AccountKit endpoint refuses a token-opened session except
 *   reading or ending itself: no passkey, no second factor, no new sign-in.
 */
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  bindTokenSession,
  consumeTokenSessionLink,
  tokenSessionState,
} from "@/db/queries/token-sessions";
import {
  SESSION_TTL_SECONDS,
  TOKEN_SESSION_AUTH_PATHS,
  TOKEN_SESSION_OPEN_PATH,
  safeNextPath,
} from "@/lib/auth/token-session";

const EXPIRED = "This link has expired or was already used. Mint a new one with your token.";

export function lokiTokenSession(): BetterAuthPlugin {
  return {
    id: "loki-token-session",
    endpoints: {
      lokiTokenSessionOpen: createAuthEndpoint(
        TOKEN_SESSION_OPEN_PATH,
        { method: "GET", query: z.object({ code: z.string().min(1).max(200) }) },
        async (ctx) => {
          const link = await consumeTokenSessionLink(ctx.query.code);
          if (!link) throw new APIError("BAD_REQUEST", { message: EXPIRED });
          const user = await ctx.context.internalAdapter.findUserById(link.userId);
          if (!user) throw new APIError("BAD_REQUEST", { message: EXPIRED });
          const session = await ctx.context.internalAdapter.createSession(
            link.userId,
            true,
            { expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) },
            true,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Unable to create session" });
          }
          try {
            await bindTokenSession(link.id, session.id);
          } catch (error) {
            // An unmarked session would be a person's full session: end it.
            await ctx.context.internalAdapter.deleteSession(session.token).catch(() => {});
            throw error;
          }
          await setSessionCookie(ctx, { session, user }, true);
          const origin = new URL(ctx.context.baseURL).origin;
          throw ctx.redirect(new URL(safeNextPath(link.nextPath), origin).toString());
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => !TOKEN_SESSION_AUTH_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const current = await getSessionFromCtx(ctx).catch(() => null);
            if (!current) return;
            if (await tokenSessionState(current.session.id)) {
              throw new APIError("FORBIDDEN", {
                message:
                  "A session opened with an agent token cannot do this. Sign in as a person.",
              });
            }
          }),
        },
      ],
    },
  };
}
