"use client";

/**
 * The browser half of AccountKit, for what next-auth/react has no word for:
 * passkeys, the second factor and the sign-in link (AUTH_RUNTIME=accountkit
 * only; src/lib/auth/shared/open-paths.ts lists the endpoints it may reach).
 * Everything else on Loki's screens still goes through next-auth/react and the
 * compat layer. Talks only to this origin (/api/auth).
 */
import { createAuthClient } from "better-auth/react";
import { authClientPlugins } from "@bitbaum/accountkit/auth/client";

export const sharedAuthClient = createAuthClient({ plugins: authClientPlugins() });
