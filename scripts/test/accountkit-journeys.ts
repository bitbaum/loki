/**
 * Loki's ways in on the staged AccountKit runtime, against a real Postgres:
 * the calls next-auth/react makes, answered by AccountKit through the bridge
 * (src/lib/auth/shared/), after the real cutover import and its mirror
 * triggers. docs/architecture/accountkit-migration.md.
 *
 * WHERE IT RUNS: only against a database it was pointed at on purpose —
 * TEST_DATABASE_URL, or DATABASE_URL when CI=true — because it EMPTIES `users`
 * (cascade). In CI: `pnpm run test:db`, after the migrate step. The migrate
 * step pushes the schema, not drizzle/*.sql, so this file applies the mirror
 * functions from migration 0130 itself (they are CREATE OR REPLACE).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
if (!target) {
  console.log(
    "accountkit-journeys: SKIP — needs TEST_DATABASE_URL (or CI=true with DATABASE_URL). " +
      "It empties users, so it never borrows a dev database by default.",
  );
  process.exit(0);
}
const SITE = "https://loki.example.test";
Object.assign(process.env, {
  DATABASE_URL: target,
  AUTH_URL: SITE,
  AUTH_RUNTIME: "accountkit",
  AUTH_SECRET: "synthetic-loki-journey-secret-at-least-32-characters",
  ENABLE_OWNER_KEY: "1",
});
delete process.env.RESEND_API_KEY;
delete process.env.BETTER_AUTH_SECRET;
delete process.env.ORANGECAT_OAUTH_CLIENT_ID;
delete process.env.LOCAL_AUTH_PASSWORD;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PASSWORD = "synthetic legacy password";
const PERSON = "00000000-0000-4000-8000-000000000001";
const INVITED = "00000000-0000-4000-8000-000000000002";
const X_ONLY = "00000000-0000-4000-8000-000000000003";
const OWNER = "00000000-0000-4000-8000-000000000004";
const OC_ACTOR = "00000000-0000-4000-8000-0000000000ac";

async function main(): Promise<number> {
  const { db } = await import("@/db");
  const { hashPassword } = await import("@/lib/password");
  const { compat } = await import("@/lib/auth/shared/compat");
  const { createCompatClient } = await import("@bitbaum/accountkit/auth/compat-testing");
  const { getEnabledAuthProviders } = await import("@/lib/auth-providers");
  const { sharedAuth } = await import("@/lib/auth/shared/runtime");
  const { isOpenSharedPath } = await import("@/lib/auth/shared/open-paths");
  const { createHmac } = await import("node:crypto");

  /** AccountKit itself, as the sign-in card and the settings page reach it. */
  let directCookie = "";
  async function direct(path: string, body: Record<string, unknown>) {
    assert.ok(isOpenSharedPath(`/api/auth/${path.slice(1)}`) || path === "/sign-in/email", path);
    const res = await sharedAuth.POST(
      new Request(`${SITE}/api/auth/${path.slice(1)}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: directCookie },
        body: JSON.stringify(body),
      }),
    );
    for (const value of res.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const name = pair.slice(0, pair.indexOf("="));
      const rest = directCookie.split("; ").filter((c) => c && !c.startsWith(`${name}=`));
      directCookie = [...rest, pair].join("; ");
    }
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  /** RFC 6238 code for an otpauth:// URI (SHA-1, 6 digits, 30 s). */
  function totp(uri: string): string {
    const secret = new URL(uri).searchParams.get("secret") ?? "";
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of secret.replace(/=+$/, "").toUpperCase())
      bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
    const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const mac = createHmac("sha1", key).update(counter).digest();
    const offset = mac[mac.length - 1] & 15;
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  }
  const raw = (db as unknown as { $client: import("postgres").Sql }).$client;

  const migration = readFileSync(resolve(root, "drizzle/0130_accountkit_staging.sql"), "utf8");
  for (const part of migration.split("--> statement-breakpoint")) {
    if (part.includes("CREATE OR REPLACE FUNCTION")) await raw.unsafe(part);
  }
  const importSql = readFileSync(resolve(root, "scripts/db/accountkit-import.sql"), "utf8");
  const importAccounts = () => raw.begin((tx) => tx.unsafe(importSql));

  const browser = createCompatClient({ compat, site: SITE });
  const request = (route: string, form?: Record<string, string>) => ({ route, form });
  const answer = (req: ReturnType<typeof request>) => browser.call(req.route, req.form);
  const signIn = (provider: string, fields: Record<string, string>) =>
    browser.signIn(provider, fields, `${SITE}/projects`);
  const errorOf = (r: { url: string }) => new URL(r.url).searchParams.get("error");
  const session = async () => (await answer(request("/session"))).json();

  async function reset() {
    browser.cookie = "";
    directCookie = "";
    await raw.unsafe(`SET client_min_messages = warning; DROP TRIGGER IF EXISTS loki_accountkit_from_users ON users;
      DROP TRIGGER IF EXISTS loki_accountkit_to_users ON auth_users;
      TRUNCATE auth_users, auth_accounts, auth_sessions, auth_verifications,
        auth_passkeys, auth_two_factors, users CASCADE`);
    const hash = await hashPassword(PASSWORD);
    await raw.unsafe(
      `INSERT INTO users (id, email, name, username, password_hash, email_verified, onboarded_at, orangecat_actor_id, is_default) VALUES
        ($1, 'Person@Example.test', 'Person', 'person', $5, now(), now(), $6, false),
        ($2, 'invited@example.test', 'Invited', NULL, $5, NULL, NULL, NULL, false),
        ($3, NULL, 'x_handle', 'x_handle', NULL, NULL, now(), NULL, false),
        ($4, 'owner@example.test', 'Owner', 'owner', $5, now(), now(), NULL, true)`,
      [PERSON, INVITED, X_ONLY, OWNER, hash, OC_ACTOR],
    );
    await importAccounts();
  }

  const cases: [string, () => Promise<void>][] = [
    [
      "an imported scrypt account signs in, in any letter case, in Loki's session shape",
      async () => {
        const r = await signIn("email-password", {
          email: "PERSON@example.test",
          password: PASSWORD,
        });
        assert.equal(errorOf(r), null);
        assert.equal(r.url, `${SITE}/projects`);
        const s = await session();
        assert.equal(s.user.id, PERSON);
        assert.equal(s.user.username, "person");
        assert.equal(s.user.onboardingComplete, true);
        assert.ok(s.user.emailVerified);
        assert.equal(s.user.isDemo, false);
      },
    ],
    [
      "wrong credentials are refused and leave no session",
      async () => {
        for (const fields of [
          { email: "person@example.test", password: "not the password" },
          { email: "nobody@example.test", password: PASSWORD },
        ]) {
          assert.equal(errorOf(await signIn("email-password", fields)), "CredentialsSignin");
          assert.equal(await session(), null);
        }
      },
    ],
    [
      "the invite flow's user-password sign-in works and bootstraps a personal org",
      async () => {
        assert.equal(
          errorOf(await signIn("user-password", { userId: INVITED, password: PASSWORD })),
          null,
        );
        assert.equal((await session()).user.id, INVITED);
        const [{ count }] =
          await raw`SELECT count(*)::int AS count FROM org_memberships WHERE user_id = ${INVITED}`;
        assert.equal(count, 1, "the first sign-in gives a personal org");
      },
    ],
    [
      "the owner key signs in the default user against the stored hash only",
      async () => {
        assert.equal(errorOf(await signIn("local", { password: PASSWORD })), null);
        assert.equal((await session()).user.id, OWNER);
      },
    ],
    [
      "a person with no address is imported with a placeholder Loki never shows",
      async () => {
        const [row] = await raw`SELECT email FROM auth_users WHERE id = ${X_ONLY}`;
        assert.equal(row.email, `loki-${X_ONLY}@users.invalid`);
        const [user] = await raw`SELECT email FROM users WHERE id = ${X_ONLY}`;
        assert.equal(user.email, null);
      },
    ],
    [
      "sign-out ends the session and lands where the page asked",
      async () => {
        await signIn("email-password", { email: "person@example.test", password: PASSWORD });
        const out = await answer(request("/signout", { csrfToken: "x", callbackUrl: `${SITE}/` }));
        assert.equal(((await out.json()) as { url: string }).url, `${SITE}/`);
        assert.equal(await session(), null);
      },
    ],
    [
      "a rename or a reseeded (deleted) account applies on the next request",
      async () => {
        await signIn("email-password", { email: "person@example.test", password: PASSWORD });
        await raw`UPDATE users SET username = 'renamed' WHERE id = ${PERSON}`;
        assert.equal(
          (await (await answer(request("/session", { data: "{}" }))).json()).user.username,
          "renamed",
        );
        await raw`DELETE FROM users WHERE id = ${PERSON}`;
        assert.equal(await session(), null);
      },
    ],
    [
      "Loki's sign-up writer reaches the shared row, so the new person signs in",
      async () => {
        await raw`INSERT INTO users (email, name, password_hash) VALUES ('fresh@example.test', 'Fresh', ${await hashPassword("a brand new password")})`;
        assert.equal(
          errorOf(
            await signIn("email-password", {
              email: "fresh@example.test",
              password: "a brand new password",
            }),
          ),
          null,
        );
      },
    ],
    [
      "changing your own password keeps your session and ends every other one",
      async () => {
        await signIn("email-password", { email: "person@example.test", password: PASSWORD });
        const mine = browser.cookie;
        browser.cookie = "";
        await signIn("email-password", { email: "person@example.test", password: PASSWORD });
        const other = browser.cookie;
        const keep = await compat.sessionIdFor(new Headers({ cookie: mine }));
        assert.ok(keep);
        const hash = await hashPassword("the new password");
        await raw.begin(async (tx) => {
          await tx`SELECT set_config('loki.keep_session', ${keep}, true)`;
          await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${PERSON}`;
        });
        browser.cookie = mine;
        assert.equal((await session())?.user?.id, PERSON, "the changing session stays");
        browser.cookie = other;
        assert.equal(await session(), null, "every other session ends");
        browser.cookie = "";
        assert.equal(
          errorOf(
            await signIn("email-password", { email: "person@example.test", password: PASSWORD }),
          ),
          "CredentialsSignin",
        );
        assert.equal(
          errorOf(
            await signIn("email-password", {
              email: "person@example.test",
              password: "the new password",
            }),
          ),
          null,
        );
      },
    ],
    [
      "OrangeCat's tokens, handed over at a first OrangeCat sign-in, reach Loki's accounts row; a refresh token is never blanked",
      async () => {
        const tokens = (accessToken: string, refreshToken: string | null) => ({
          accessToken,
          refreshToken,
          idToken: null,
          accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
          scope: "openid",
        });
        const { ensureLokiUser } = await import("@/lib/auth/shared/accounts");
        const link = { userId: PERSON, providerId: "orangecat", accountId: OC_ACTOR };
        await ensureLokiUser({ ...link, tokens: tokens("at-1", "rt-1") });
        let [row] =
          await raw`SELECT user_id, access_token, refresh_token, expires_at FROM accounts WHERE provider = 'orangecat'`;
        assert.deepEqual(
          [row.user_id, row.access_token, row.refresh_token],
          [PERSON, "at-1", "rt-1"],
        );
        assert.ok(row.expires_at > Date.now() / 1000);
        await ensureLokiUser({ ...link, tokens: tokens("at-2", null) });
        [row] =
          await raw`SELECT access_token, refresh_token FROM accounts WHERE provider = 'orangecat'`;
        assert.deepEqual([row.access_token, row.refresh_token], ["at-2", "rt-1"]);
        const [stored] =
          await raw`SELECT count(*)::int AS n FROM auth_accounts WHERE access_token IS NOT NULL`;
        assert.equal(stored.n, 0, "AccountKit's own table holds no provider token");
      },
    ],
    [
      "a GitHub link made under Auth.js is imported, so GitHub signs the same person in; its token stays Loki's",
      async () => {
        await raw`INSERT INTO accounts (user_id, type, provider, provider_account_id, access_token, scope)
          VALUES (${PERSON}, 'oauth', 'github', '4242', 'gh-old', 'repo')`;
        await importAccounts();
        const [link] =
          await raw`SELECT user_id, access_token FROM auth_accounts WHERE provider_id = 'github' AND account_id = '4242'`;
        assert.deepEqual([link.user_id, link.access_token], [PERSON, null]);
        const { ensureLokiUser } = await import("@/lib/auth/shared/accounts");
        await ensureLokiUser({
          userId: PERSON,
          providerId: "github",
          accountId: "4242",
          tokens: {
            accessToken: "gh-new",
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            scope: "read:user,user:email,repo,workflow",
          },
        });
        const [row] =
          await raw`SELECT access_token, scope FROM accounts WHERE provider = 'github' AND provider_account_id = '4242'`;
        assert.deepEqual(
          [row.access_token, row.scope],
          ["gh-new", "read:user,user:email,repo,workflow"],
        );
      },
    ],
    [
      "a person AccountKit creates itself gets a Loki row, a personal org, and no placeholder address",
      async () => {
        const { ensureLokiUser } = await import("@/lib/auth/shared/accounts");
        const id = "00000000-0000-4000-8000-0000000000aa";
        const actor = "00000000-0000-4000-8000-0000000000ab";
        await raw`INSERT INTO auth_users (id, name, email) VALUES (${id}, 'New', 'x@orangecat.invalid')`;
        const noTokens = {
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: null,
          scope: null,
        };
        const created = { userId: id, providerId: "orangecat", accountId: actor, tokens: noTokens };
        await ensureLokiUser(created);
        await ensureLokiUser(created);
        const [row] = await raw`SELECT email, orangecat_actor_id FROM users WHERE id = ${id}`;
        assert.deepEqual([row.email, row.orangecat_actor_id], [null, actor]);
        const [{ count }] =
          await raw`SELECT count(*)::int AS count FROM org_memberships WHERE user_id = ${id}`;
        assert.equal(count, 1);
      },
    ],
    [
      "GitHub signs in through Loki's own app; Google, X and the env owner key are not offered on this runtime",
      async () => {
        process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_SECRET = "set";
        process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_SECRET = "set";
        const enabled = getEnabledAuthProviders();
        assert.deepEqual(
          [enabled.github, enabled.google, enabled.x, enabled.localOwnerKeyTab],
          [true, false, false, false],
        );
        assert.deepEqual(Object.keys(compat.providers()), [
          "github",
          "email-password",
          "user-password",
          "local",
        ]);
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;
        const res = await answer(request("/signin"));
        assert.equal(res.status, 302);
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
      },
    ],
    [
      "AccountKit's own credential writers stay closed until Loki adopts its screens",
      async () => {
        for (const route of ["/sign-up/email", "/change-password", "/request-password-reset"]) {
          assert.equal(
            (await answer(request(route, { email: "x@example.test" }))).status,
            404,
            route,
          );
        }
      },
    ],
    [
      "the second factor: a password alone gets the code step, and the code signs in",
      async () => {
        let r = await direct("/sign-in/email", {
          email: "person@example.test",
          password: PASSWORD,
        });
        assert.equal(r.status, 200);
        r = await direct("/two-factor/enable", { password: PASSWORD });
        assert.equal(r.status, 200, "turning it on asks for the password, which is Loki's");
        const uri = r.body.totpURI as string;
        r = await direct("/two-factor/verify-totp", { code: totp(uri) });
        assert.equal(r.status, 200, "the first code confirms it");
        directCookie = "";
        r = await direct("/sign-in/email", { email: "person@example.test", password: PASSWORD });
        assert.equal(r.body?.twoFactorRedirect, true, "a password alone is not enough");
        assert.ok(!/session_token=[^;]/.test(directCookie), "and makes no session");
        r = await direct("/two-factor/verify-totp", { code: totp(uri) });
        assert.equal(r.status, 200);
        assert.ok(/session_token=[^;]/.test(directCookie), "the code makes the session");
      },
    ],
    [
      "a person AccountKit has but Loki does not gets a Loki row and a workspace at sign-in",
      async () => {
        // What a sign-in link to a new address leaves behind: an AccountKit
        // person whom no sign-in method attachment introduced to Loki.
        const id = "00000000-0000-4000-8000-0000000000aa";
        const { hashPassword: nativeHash } = await import("better-auth/crypto");
        await raw`INSERT INTO auth_users (id, email, name, email_verified, created_at, updated_at)
          VALUES (${id}, 'linked@example.test', 'Linked', true, now(), now())`;
        await raw`INSERT INTO auth_accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
          VALUES (${"acct-" + id}, ${id}, 'credential', ${id}, ${await nativeHash(PASSWORD)}, now(), now())`;
        assert.equal((await raw`SELECT 1 FROM users WHERE id = ${id}`).length, 0);
        const r = await direct("/sign-in/email", {
          email: "linked@example.test",
          password: PASSWORD,
        });
        assert.equal(r.status, 200);
        const [row] = await raw`SELECT email FROM users WHERE id = ${id}`;
        assert.equal(row?.email, "linked@example.test");
        const [{ count }] =
          await raw`SELECT count(*)::int AS count FROM org_memberships WHERE user_id = ${id}`;
        assert.equal(count, 1);
      },
    ],
    [
      "passkeys, the second factor and the sign-in link are open; password writers are not",
      async () => {
        for (const path of [
          "/passkey/generate-authenticate-options",
          "/two-factor/verify-totp",
          "/magic-link/verify",
        ])
          assert.ok(isOpenSharedPath(`/api/auth/${path.slice(1)}`), path);
        for (const path of [
          "/sign-up/email",
          "/change-password",
          "/request-password-reset",
          "/reset-password",
          "/update-user",
          "/delete-user",
        ])
          assert.ok(!isOpenSharedPath(`/api/auth/${path.slice(1)}`), path);
      },
    ],
    [
      "the import is a no-op for the same snapshot and refuses drift",
      async () => {
        await importAccounts();
        await raw`DROP TRIGGER loki_accountkit_from_users ON users`;
        await raw`UPDATE users SET email_verified = now() WHERE id = ${INVITED}`;
        await assert.rejects(importAccounts(), /snapshot differs/);
      },
    ],
    [
      "the import refuses addresses that collide once lower-cased",
      async () => {
        await raw.unsafe(
          `DROP TRIGGER loki_accountkit_from_users ON users; TRUNCATE auth_users CASCADE`,
        );
        await raw`INSERT INTO users (email, name) VALUES ('PERSON@example.test', 'Twin')`;
        await assert.rejects(importAccounts(), /address reconciliation/);
      },
    ],
  ];

  let failures = 0;
  for (const [name, run] of cases) {
    await reset();
    try {
      await run();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.log(
        `  ✗ ${name}\n    ${(error as Error).stack?.split("\n").slice(0, 4).join("\n    ")}`,
      );
    }
  }
  await raw.unsafe(`SET client_min_messages = warning; DROP TRIGGER IF EXISTS loki_accountkit_from_users ON users;
    DROP TRIGGER IF EXISTS loki_accountkit_to_users ON auth_users;
    TRUNCATE auth_users, auth_accounts, auth_sessions, auth_verifications, users CASCADE`);
  await raw.end();

  // The rehearsal CLI must also pass on this chain (it rolls back).
  try {
    const out = execFileSync("pnpm", ["run", "-s", "db:rehearse-import"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: target },
      encoding: "utf8",
    });
    console.log(`  ✓ the rehearsal rolls back: ${out.trim()}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ the rehearsal failed: ${(error as Error).message}`);
  }
  console.log(
    failures
      ? `accountkit-journeys: ${failures} failed`
      : `accountkit-journeys: ${cases.length + 1} passed`,
  );
  return failures ? 1 : 0;
}

void main().then((code) => process.exit(code));
