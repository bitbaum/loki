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

// The secret is BETTER_AUTH_SECRET, or the AUTH_SECRET the box already holds.
export const sharedAuth = createAuthRuntime({
  site,
  // Account mail through the fleet transport (RESEND_*).
  mail: createAuthMailer({ site }),
  isDatabaseConfigured: (env) => sharedRuntimeEnabled(env) && Boolean(env.DATABASE_URL),
  getDatabase: () => db,
  schema: authTables,
  // Imported hashes keep working, and Loki's own writers keep writing them.
  legacyPassword: lokiPasswordFormat,
  // users.id is a uuid that every Loki table references.
  ids: "uuid",
  onAccountCreated: ensureLokiUser,
});
