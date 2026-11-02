-- Copy Loki's accounts into AccountKit's auth_* tables (migration 0130). Run
-- only inside a transaction, with Loki's credential writes stopped for the
-- cutover. The rehearsal (accountkit-import-rehearse.ts) always rolls back;
-- this is deliberately not a migration. docs/architecture/accountkit-migration.md.
--
-- Each users.id stays the shared user id, so every table that references it
-- (projects, orgs, runs, conversations) keeps pointing at the same person.
-- Password hashes are copied as they are (Loki's scrypt `hex.salt`, read by
-- AccountKit's legacyPassword). A linked OrangeCat actor becomes an
-- `orangecat` account row. A person with no address (an X sign-in) gets a
-- placeholder AccountKit needs and Loki never shows. GitHub, Google and X
-- links stay in Auth.js's `accounts`, where the product's GitHub features read
-- their tokens.
LOCK TABLE users, auth_users, auth_accounts, auth_sessions,
  auth_passkeys, auth_two_factors, auth_verifications IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE loki_accountkit_users ON COMMIT DROP AS
SELECT id::text AS id, coalesce(name, '') AS name, loki_accountkit_address(id, email) AS email,
  email_verified IS NOT NULL AS verified, image, password_hash AS password,
  orangecat_actor_id::text AS orangecat_actor_id
FROM users;

DO $$ BEGIN
  IF EXISTS (SELECT email FROM loki_accountkit_users GROUP BY email HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM loki_accountkit_users WHERE email NOT LIKE '%@%')
  THEN RAISE EXCEPTION 'Account import requires address reconciliation'; END IF;

  -- Never a second writer beside a live shared runtime: nothing a person did
  -- there (a session, a passkey, a factor, a token) may be overwritten.
  IF EXISTS (SELECT 1 FROM auth_sessions) OR EXISTS (SELECT 1 FROM auth_passkeys)
    OR EXISTS (SELECT 1 FROM auth_two_factors) OR EXISTS (SELECT 1 FROM auth_verifications)
  THEN RAISE EXCEPTION 'Account import refuses an active shared runtime'; END IF;
END $$;

INSERT INTO auth_users (id, name, email, email_verified, image)
SELECT id, name, email, verified, image FROM loki_accountkit_users
ON CONFLICT DO NOTHING;

INSERT INTO auth_accounts (id, account_id, provider_id, user_id, password)
SELECT 'loki-credential:' || id, id, 'credential', id, password
FROM loki_accountkit_users WHERE password IS NOT NULL
ON CONFLICT DO NOTHING;

-- "Sign in with OrangeCat": the actor id is the provider's subject, exactly
-- the (provider_id, account_id) pair AccountKit's OIDC sign-in looks up.
INSERT INTO auth_accounts (id, account_id, provider_id, user_id)
SELECT 'loki-orangecat:' || orangecat_actor_id, orangecat_actor_id, 'orangecat', id
FROM loki_accountkit_users WHERE orangecat_actor_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  -- A repeat is a no-op only for the same snapshot. Anything that drifted (an
  -- address, a verification, a password, a link) fails the whole transaction.
  IF EXISTS (
    SELECT 1 FROM loki_accountkit_users s
    LEFT JOIN auth_users u ON u.id = s.id
    LEFT JOIN auth_accounts c ON c.user_id = s.id AND c.provider_id = 'credential'
    LEFT JOIN auth_accounts o ON o.user_id = s.id AND o.provider_id = 'orangecat'
    WHERE u.id IS NULL OR u.email IS DISTINCT FROM s.email
      OR u.email_verified IS DISTINCT FROM s.verified
      OR c.password IS DISTINCT FROM s.password
      OR (s.password IS NULL AND c.id IS NOT NULL)
      OR o.account_id IS DISTINCT FROM s.orangecat_actor_id
  ) OR EXISTS (
    SELECT 1 FROM auth_users u
    WHERE NOT EXISTS (SELECT 1 FROM loki_accountkit_users s WHERE s.id = u.id)
  ) THEN RAISE EXCEPTION 'Account import snapshot differs; no changes committed'; END IF;
END $$;

-- From here on every writer keeps the other side in step (functions in
-- migration 0130). Rolled back with everything else in a rehearsal.
DROP TRIGGER IF EXISTS loki_accountkit_from_users ON users;
CREATE TRIGGER loki_accountkit_from_users AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION loki_accountkit_from_users();
DROP TRIGGER IF EXISTS loki_accountkit_to_users ON auth_users;
CREATE TRIGGER loki_accountkit_to_users AFTER UPDATE ON auth_users
  FOR EACH ROW EXECUTE FUNCTION loki_accountkit_to_users();
