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
  const bridge = await import("@/lib/auth/shared/bridge");
  const runtime = await import("@/lib/auth/shared/runtime");
  const sessionMod = await import("@/lib/auth/shared/session");
  const { getEnabledAuthProviders } = await import("@/lib/auth-providers");
  const raw = (db as unknown as { $client: import("postgres").Sql }).$client;

  const migration = readFileSync(resolve(root, "drizzle/0130_accountkit_staging.sql"), "utf8");
  for (const part of migration.split("--> statement-breakpoint")) {
    if (part.includes("CREATE OR REPLACE FUNCTION")) await raw.unsafe(part);
  }
  const importSql = readFileSync(resolve(root, "scripts/db/accountkit-import.sql"), "utf8");
  const importAccounts = () => raw.begin((tx) => tx.unsafe(importSql));

  let cookie = "";
  let ip = 0;
  const request = (route: string, form?: Record<string, string>) => {
    ip += 1;
    const headers = new Headers({
      origin: SITE,
      "x-forwarded-for": `198.51.100.${ip % 250}`,
      cookie,
    });
    if (form) headers.set("content-type", "application/x-www-form-urlencoded");
    return new Request(`${SITE}/api/auth${route}`, {
      method: form ? "POST" : "GET",
      headers,
      body: form ? new URLSearchParams(form) : undefined,
    });
  };
  const answer = async (req: Request) => {
    const res =
      (await bridge.nextAuthClientCompat(req)) ??
      (await (req.method === "GET" ? runtime.sharedAuth.GET(req) : runtime.sharedAuth.POST(req)));
    const jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)] as [string, string]),
    );
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (/max-age=0/i.test(set) || value === "") jar.delete(name);
      else jar.set(name, value);
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return res;
  };
  const signIn = async (provider: string, fields: Record<string, string>) =>
    (await (
      await answer(
        request(`/callback/${provider}`, {
          ...fields,
          csrfToken: "x",
          callbackUrl: `${SITE}/projects`,
        }),
      )
    ).json()) as { url: string };
  const errorOf = (r: { url: string }) => new URL(r.url).searchParams.get("error");
  const session = async () => (await answer(request("/session"))).json();

  async function reset() {
    cookie = "";
    await raw.unsafe(`SET client_min_messages = warning; DROP TRIGGER IF EXISTS loki_accountkit_from_users ON users;
      DROP TRIGGER IF EXISTS loki_accountkit_to_users ON auth_users;
      DROP TRIGGER IF EXISTS loki_accountkit_tokens_to_accounts ON auth_accounts;
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
        const mine = cookie;
        cookie = "";
        await signIn("email-password", { email: "person@example.test", password: PASSWORD });
        const other = cookie;
        const keep = await sessionMod.sharedSessionId(new Headers({ cookie: mine }));
        assert.ok(keep);
        const hash = await hashPassword("the new password");
        await raw.begin(async (tx) => {
          await tx`SELECT set_config('loki.keep_session', ${keep}, true)`;
          await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${PERSON}`;
        });
        cookie = mine;
        assert.equal((await session())?.user?.id, PERSON, "the changing session stays");
        cookie = other;
        assert.equal(await session(), null, "every other session ends");
        cookie = "";
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
      "an OrangeCat token set AccountKit stores reaches Loki's accounts row, never blanking a refresh token",
      async () => {
        await raw`UPDATE auth_accounts SET access_token = 'at-1', refresh_token = 'rt-1',
        access_token_expires_at = now() + interval '1 hour', scope = 'openid'
        WHERE provider_id = 'orangecat' AND account_id = ${OC_ACTOR}`;
        let [row] =
          await raw`SELECT user_id, access_token, refresh_token, expires_at FROM accounts WHERE provider = 'orangecat'`;
        assert.deepEqual(
          [row.user_id, row.access_token, row.refresh_token],
          [PERSON, "at-1", "rt-1"],
        );
        assert.ok(row.expires_at > Date.now() / 1000);
        await raw`UPDATE auth_accounts SET access_token = 'at-2', refresh_token = NULL WHERE provider_id = 'orangecat'`;
        [row] =
          await raw`SELECT access_token, refresh_token FROM accounts WHERE provider = 'orangecat'`;
        assert.deepEqual([row.access_token, row.refresh_token], ["at-2", "rt-1"]);
      },
    ],
    [
      "a person AccountKit creates itself gets a Loki row, a personal org, and no placeholder address",
      async () => {
        const { ensureLokiUser } = await import("@/lib/auth/shared/accounts");
        const id = "00000000-0000-4000-8000-0000000000aa";
        const actor = "00000000-0000-4000-8000-0000000000ab";
        await raw`INSERT INTO auth_users (id, name, email) VALUES (${id}, 'New', 'x@orangecat.invalid')`;
        await ensureLokiUser({ userId: id, providerId: "orangecat", accountId: actor });
        await ensureLokiUser({ userId: id, providerId: "orangecat", accountId: actor });
        const [row] = await raw`SELECT email, orangecat_actor_id FROM users WHERE id = ${id}`;
        assert.deepEqual([row.email, row.orangecat_actor_id], [null, actor]);
        const [{ count }] =
          await raw`SELECT count(*)::int AS count FROM org_memberships WHERE user_id = ${id}`;
        assert.equal(count, 1);
      },
    ],
    [
      "GitHub, Google, X and the env owner key are not offered on this runtime",
      async () => {
        process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_SECRET = "set";
        const enabled = getEnabledAuthProviders();
        assert.deepEqual(
          [enabled.github, enabled.google, enabled.x, enabled.localOwnerKeyTab],
          [false, false, false, false],
        );
        assert.deepEqual(Object.keys(bridge.providers({ ENABLE_OWNER_KEY: "1" })), [
          "email-password",
          "user-password",
          "local",
        ]);
        const res = await answer(request("/signin"));
        assert.equal(res.status, 307);
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
    DROP TRIGGER IF EXISTS loki_accountkit_tokens_to_accounts ON auth_accounts;
    TRUNCATE auth_users, auth_accounts, auth_sessions, auth_verifications, users CASCADE`);
  await raw.end();

  // The rehearsal CLI must also pass on this chain (it rolls back).
  try {
    const out = execFileSync("npx", ["tsx", "scripts/db/accountkit-import-rehearse.ts"], {
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
