-- GitHub signs people in on AccountKit through Loki's own GitHub app
-- (AccountKit 0.20, src/lib/auth/shared/runtime.ts). A person who linked
-- GitHub under Auth.js must arrive as themselves, so their link is recorded
-- in AccountKit's table as the import now does (scripts/db/accountkit-import.sql).
-- Only where AccountKit holds the person: before a switch this copies nothing.
INSERT INTO auth_accounts (id, account_id, provider_id, user_id, created_at, updated_at)
SELECT 'loki-github:' || a.provider_account_id, a.provider_account_id, 'github', a.user_id::text, now(), now()
FROM accounts a JOIN auth_users u ON u.id = a.user_id::text
WHERE a.provider = 'github'
ON CONFLICT DO NOTHING;
