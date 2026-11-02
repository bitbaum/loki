/**
 * Every new session on the shared runtime gets what a Loki sign-in always
 * gets, whichever way the person came in: password (through the compat layer
 * or the sign-in card's second-factor step), passkey, the sign-in link, or an
 * OIDC round trip.
 *
 * - The person has a Loki `users` row under their AccountKit id. Since
 *   AccountKit 0.21, `onAccountCreated` (ensureLokiUser) makes it for every
 *   new person, a first sign-in link included; this is the heal for anyone it
 *   did not reach (a logged failure there, an AccountKit person made outside
 *   AccountKit), checked by scripts/test/accountkit-journeys.ts.
 * - Onboarding heal and the personal org (bootstrapAfterSignIn).
 *
 * Both are idempotent and never block the sign-in: a throw is logged.
 */
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { bootstrapAfterSignIn } from "../bootstrap";
import { ensureLokiUser } from "./accounts";

export function lokiSignInHook(): BetterAuthPlugin {
  return {
    id: "loki-sign-in",
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created) return;
            const { user } = created;
            try {
              await ensureLokiUser({
                userId: user.id,
                providerId: "session",
                accountId: user.id,
                tokens: {
                  accessToken: null,
                  refreshToken: null,
                  idToken: null,
                  accessTokenExpiresAt: null,
                  scope: null,
                },
              });
              const email = user.email?.endsWith(".invalid") ? null : user.email;
              await bootstrapAfterSignIn({ id: user.id, name: user.name || null, email });
            } catch (error) {
              console.error(`[auth] Loki sign-in hook failed: ${(error as Error).name}`);
            }
          }),
        },
      ],
    },
  };
}
