/**
 * Loki on AccountKit's shared account runtime. Off until AUTH_RUNTIME=accountkit;
 * Auth.js stays authoritative until the import and the switch
 * (docs/architecture/accountkit-migration.md).
 */
import { createAuthRuntime } from "@bitbaum/accountkit/auth/next";
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";
import { createAuthMailer } from "@bitbaum/accountkit/auth/mail";
import { APP_URL } from "@/config/brand";
import { db } from "@/db";
import { authTables } from "@/db/schema/accountkit";
import { verifyPassword } from "@/lib/password";
import { ensureLokiUser } from "./accounts";
import { lokiSignInHook } from "./sign-in-hook";

/** The public origin every redirect and every AccountKit origin check uses. */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AUTH_URL || env.NEXTAUTH_URL || APP_URL).replace(/\/$/, "");
}

/** Loki's own pre-AccountKit format (src/lib/password.ts): scrypt, `<hex>.<salt>`. */
export const lokiPasswordFormat = {
  matches: (hash: string) => /^[0-9a-f]{128}\.[0-9a-f]{32}$/.test(hash),
  verify: verifyPassword,
};

const site = { url: siteUrl(), title: "Loki", slug: "loki" };

// Account mail through the fleet transport (RESEND_*).
const mailer = createAuthMailer({ site });

// The secret is BETTER_AUTH_SECRET, or the AUTH_SECRET the box already holds.
export const sharedAuth = createAuthRuntime({
  site,
  mail: mailer,
  isDatabaseConfigured: (env) => sharedRuntimeEnabled(env) && Boolean(env.DATABASE_URL),
  getDatabase: () => db,
  schema: authTables,
  // Imported hashes keep working, and Loki's own writers keep writing them.
  legacyPassword: lokiPasswordFormat,
  // users.id is a uuid that every Loki table references.
  ids: "uuid",
  onAccountCreated: ensureLokiUser,
  // GitHub through Loki's own app, with the grant "Start a new project" and
  // the repository features act with (see the GitHub provider in src/auth.ts).
  githubScopes: ["repo", "workflow"],
  // Loki's row and bootstrap after every new session, whatever the way in.
  plugins: [lokiSignInHook()],
});
