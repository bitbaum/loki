"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser half. Talks only to this origin (/api/auth), which is all the
 * CSP's `connect-src 'self'` allows. Server code reads the session through
 * lib/auth/session.ts instead.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient(), magicLinkClient()],
});
