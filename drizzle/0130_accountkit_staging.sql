-- AccountKit's account tables, staged beside Auth.js (bitbaum/accountkit).
-- Nothing reads or writes them until AUTH_RUNTIME=accountkit; the mirror
-- functions at the end are attached only by scripts/db/accountkit-import.sql,
-- deliberately not a migration (docs/architecture/accountkit-migration.md).
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "auth_passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'customer' NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_uidx" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_passkeys_user_id_idx" ON "auth_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factors_user_id_idx" ON "auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factors_secret_idx" ON "auth_two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");
--> statement-breakpoint
-- The mirrors, attached only by the cutover import. Once attached:
--
-- users -> auth_users: every Loki writer of `users` (sign-up, invites, the
-- reset link, the settings password change, setup, admin edits, deletion)
-- keeps the shared row in step. A person with no address (an X sign-in) gets
-- a placeholder that is never copied back. A password is copied only when
-- `users.password_hash` itself changes, and that change ends every shared
-- session except the one named in `loki.keep_session`.
--
-- auth_users -> users: a verification, or a real address change, made by
-- AccountKit reaches `users`.
--
-- auth_accounts -> accounts: an OrangeCat sign-in through AccountKit stores
-- its token set where Loki's publish, promote and wallet features read it
-- (src/lib/auth/persist-oauth-tokens.ts). A refresh token is only ever
-- replaced, never blanked.
CREATE OR REPLACE FUNCTION loki_accountkit_address(id uuid, email text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(lower(trim(email)), ''), 'loki-' || id::text || '@users.invalid')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION loki_accountkit_from_users() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM auth_users WHERE id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO auth_users (id, name, email, email_verified, image)
    VALUES (NEW.id::text, coalesce(NEW.name, ''), loki_accountkit_address(NEW.id, NEW.email),
      NEW.email_verified IS NOT NULL, NEW.image)
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE auth_users SET
      name = coalesce(NEW.name, ''),
      email = loki_accountkit_address(NEW.id, NEW.email),
      email_verified = NEW.email_verified IS NOT NULL,
      image = NEW.image,
      updated_at = now()
    WHERE id = NEW.id::text AND (
      name IS DISTINCT FROM coalesce(NEW.name, '')
      OR email IS DISTINCT FROM loki_accountkit_address(NEW.id, NEW.email)
      OR email_verified IS DISTINCT FROM (NEW.email_verified IS NOT NULL)
      OR image IS DISTINCT FROM NEW.image);
  END IF;

  IF NEW.password_hash IS NOT NULL AND (TG_OP = 'INSERT'
      OR NEW.password_hash IS DISTINCT FROM OLD.password_hash) THEN
    INSERT INTO auth_accounts (id, account_id, provider_id, user_id, password)
    VALUES ('loki-credential:' || NEW.id, NEW.id::text, 'credential', NEW.id::text, NEW.password_hash)
    ON CONFLICT (provider_id, account_id)
      DO UPDATE SET password = EXCLUDED.password, updated_at = now();
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM auth_sessions WHERE user_id = NEW.id::text
        AND id IS DISTINCT FROM nullif(current_setting('loki.keep_session', true), '');
    END IF;
  END IF;

  IF NEW.orangecat_actor_id IS NOT NULL AND (TG_OP = 'INSERT'
      OR NEW.orangecat_actor_id IS DISTINCT FROM OLD.orangecat_actor_id) THEN
    INSERT INTO auth_accounts (id, account_id, provider_id, user_id)
    VALUES ('loki-orangecat:' || NEW.orangecat_actor_id, NEW.orangecat_actor_id::text,
      'orangecat', NEW.id::text)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION loki_accountkit_to_users() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email_verified AND NOT OLD.email_verified THEN
    UPDATE users SET email_verified = now()
    WHERE id::text = NEW.id AND email_verified IS NULL;
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email NOT LIKE '%.invalid' THEN
    UPDATE users SET email = NEW.email
    WHERE id::text = NEW.id AND lower(coalesce(email, '')) IS DISTINCT FROM NEW.email;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION loki_accountkit_tokens_to_accounts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_id <> 'orangecat' OR NEW.access_token IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO accounts (user_id, type, provider, provider_account_id, access_token,
    refresh_token, expires_at, token_type, scope, id_token)
  VALUES (NEW.user_id::uuid, 'oidc', 'orangecat', NEW.account_id, NEW.access_token,
    NEW.refresh_token, extract(epoch FROM NEW.access_token_expires_at)::integer, 'bearer',
    NEW.scope, NEW.id_token)
  ON CONFLICT (provider, provider_account_id) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    refresh_token = coalesce(EXCLUDED.refresh_token, accounts.refresh_token),
    expires_at = coalesce(EXCLUDED.expires_at, accounts.expires_at),
    scope = coalesce(EXCLUDED.scope, accounts.scope),
    id_token = coalesce(EXCLUDED.id_token, accounts.id_token);
  RETURN NEW;
END $$;
