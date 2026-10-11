import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Accounts, end to end, against a real Postgres built from drizzle/ — the
 * check that the schema and better-auth agree, which no unit test can make.
 *
 * DESTRUCTIVE: it drops and recreates the `public` schema of DATABASE_URL, so
 * it refuses to run unless the database name ends in `_test`.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.slice(1) : "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run: DATABASE_URL must name a *_test database (got "${dbName}")`);
}

// Fresh per run: a fixed secret in a test file is still a secret in git.
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.SECRET_SEAL_KEY = randomBytes(32).toString("hex");

const { SITE } = await import("@/lib/site");
const route = await import("@/app/api/auth/[...all]/route");
const health = await import("@/app/api/health/route");
const modelSettings = await import("@/app/api/settings/model/route");
const { saveOwnModel } = await import("@/lib/own-model");

let ip = 0;
const nextIp = () => `198.51.100.${++ip}`;

function post(path: string, body: unknown, init: { cookie?: string; ip?: string } = {}) {
  return route.POST(
    new Request(`${SITE.url}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE.url,
        "x-forwarded-for": init.ip ?? nextIp(),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function get(path: string, cookie?: string) {
  return route.GET(
    new Request(`${SITE.url}/api/auth${path}`, {
      headers: { "x-forwarded-for": nextIp(), ...(cookie ? { cookie } : {}) },
    }),
  );
}

/** The session cookie a response set, as a Cookie header. */
function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const db = new Client({ connectionString: url });

beforeAll(async () => {
  await db.connect();
  await db.query("drop schema if exists public cascade; create schema public;");
  const dir = join(process.cwd(), "drizzle");
  for (const file of readdirSync(dir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()) {
    for (const statement of readFileSync(join(dir, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await db.query(statement);
    }
  }
});

afterAll(async () => {
  await db.end();
});

describe("email and password", () => {
  const email = "person@example.ch";
  const password = "a long enough passphrase";
  let cookie = "";

  it("creates an account without a real name, and signs it in", async () => {
    const response = await post("/sign-up/email", { email, password, name: "" });
    expect(response.status).toBe(200);
    cookie = cookieOf(response);
    expect(cookie).toContain("session_token");
  });

  it("never lets a person choose their own role", async () => {
    const response = await post("/sign-up/email", {
      email: "climber@example.ch",
      password,
      name: "x",
      role: "admin",
    });
    expect(response.status).toBe(200);
    const { rows } = await db.query("select role from users where email = $1", [
      "climber@example.ch",
    ]);
    expect(rows[0]?.role).toBe("customer");
  });

  it("reads the session back, as a customer", async () => {
    const response = await get("/get-session", cookie);
    const session = (await response.json()) as { user: { email: string; role: string } };
    expect(session.user.email).toBe(email);
    expect(session.user.role).toBe("customer");
  });

  it("stores a slow hash, never the password, and no IP address", async () => {
    const { rows } = await db.query(
      "select a.password, s.ip_address from accounts a join sessions s using (user_id) where a.provider_id = 'credential' limit 1",
    );
    expect(rows[0]?.password).toBeTruthy();
    expect(rows[0]?.password).not.toContain(password);
    expect(rows[0]?.ip_address || null).toBeNull();
  });

  it("refuses a wrong password", async () => {
    const response = await post("/sign-in/email", { email, password: "wrong wrong wrong" });
    expect(response.status).toBe(401);
  });

  it("signs in with the right one", async () => {
    const response = await post("/sign-in/email", { email, password });
    expect(response.status).toBe(200);
  });

  it("stops guessing at the tenth attempt from one address, however the client forges its header", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      // A fresh forged first hop every time; the proxy's hop stays the same.
      const forged = `10.0.${i}.1, 203.0.113.50`;
      statuses.push(
        (await post("/sign-in/email", { email, password: "guess guess guess" }, { ip: forged }))
          .status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("offers passkey registration to a signed-in person", async () => {
    const response = await get("/passkey/generate-register-options", cookie);
    expect(response.status).toBe(200);
    const options = (await response.json()) as { challenge?: string; rp?: { id: string } };
    expect(options.challenge).toBeTruthy();
    expect(options.rp?.id).toBe(new URL(SITE.url).hostname);
  });

  it("sets up two-factor with the secret encrypted at rest", async () => {
    const response = await post("/two-factor/enable", { password }, { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { totpURI: string; backupCodes: string[] };
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\//);
    const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
    const { rows } = await db.query("select secret from two_factors");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.secret).not.toContain(secret);
  });

  it("keeps a person's own model key sealed, and never returns it", async () => {
    const { rows: users } = await db.query("select id from users where email = $1", [email]);
    await saveOwnModel(users[0]!.id as string, {
      vendor: "openrouter",
      apiKey: "sk-or-v1-supersecretkey9876",
      model: "some/model",
    });
    const { rows } = await db.query("select sealed_key, hint from model_keys");
    expect(rows[0]?.sealed_key).not.toContain("supersecret");
    const response = await modelSettings.GET(
      new Request(`${SITE.url}/api/settings/model`, { headers: { cookie } }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("supersecret");
    expect(text).toContain("9876");
  });

  it("deletes the account and everything hanging off it", async () => {
    const response = await post("/delete-user", { password }, { cookie });
    expect(response.status).toBe(200);
    const { rows } = await db.query(
      "select (select count(*) from users where email = $1) as users, (select count(*) from model_keys) as keys",
      [email],
    );
    expect(Number(rows[0]?.users)).toBe(0);
    expect(Number(rows[0]?.keys)).toBe(0);
  });
});

describe("health", () => {
  it("is green when the app can read its own tables", async () => {
    const response = await health.GET();
    const body = (await response.json()) as { ok: boolean; db: string };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, db: "up" });
  });
});
