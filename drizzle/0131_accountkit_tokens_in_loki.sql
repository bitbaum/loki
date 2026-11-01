-- OrangeCat's tokens reach Loki's `accounts` from AccountKit's onAccountCreated
-- (src/lib/auth/shared/accounts.ts), which receives them as AccountKit 0.19
-- hands them over. AccountKit stores no provider token, so the trigger that
-- copied them out of auth_accounts never had anything to copy.
DROP TRIGGER IF EXISTS loki_accountkit_tokens_to_accounts ON auth_accounts;--> statement-breakpoint
DROP FUNCTION IF EXISTS loki_accountkit_tokens_to_accounts();
