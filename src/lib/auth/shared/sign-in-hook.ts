/**
 * Every new session on the shared runtime gets what a Loki sign-in always
 * gets, whichever way the person came in: password (through the compat layer
 * or the sign-in card's second-factor step), passkey, the sign-in link, or an
 * OIDC round trip: the onboarding heal and the personal org
 * (bootstrapAfterSignIn).
 *
 * The person's Loki `users` row is not made here. AccountKit's
 * `onAccountCreated` (ensureLokiUser, ./runtime) reaches every new person,
 * a first sign-in link to a new address included, before their first session.
 *
 * Idempotent, and never blocks the sign-in: a throw is logged.
 */
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { bootstrapAfterSignIn } from "../bootstrap";

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
