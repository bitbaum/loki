/**
 * Loki's sign-up, sign-in, recovery and account panel on AccountKit's own
 * screens, in real Chromium at 390 and 320px, against a running Loki on
 * AUTH_RUNTIME=accountkit with a throwaway database:
 *
 *   LOKI_SCREENS_BASE_URL=http://localhost:3999 \
 *   LOKI_SCREENS_DATABASE_URL=postgres://…/loki_test npx tsx scripts/test/accountkit-screens-browser.ts
 *
 * It creates synthetic people (…@example.test). Skipped without both
 * variables (scripts/test-unit.ts, SKIP_UNLESS_ENV).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright";

const base = process.env.LOKI_SCREENS_BASE_URL;
const database = process.env.LOKI_SCREENS_DATABASE_URL;
if (!base || !database) {
  console.log(
    "accountkit-screens-browser: SKIP — needs LOKI_SCREENS_BASE_URL and LOKI_SCREENS_DATABASE_URL",
  );
  process.exit(0);
}

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) failed++;
};
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function main() {
  const browser = await chromium.launch();
  for (const width of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const email = `screens-${width}-${Date.now()}@example.test`;
    const password = "a synthetic screens password";

    await page.goto(`${base}/sign-up`, { waitUntil: "networkidle" });
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>("main input")]
        .filter((i) => i.offsetParent)
        .map((i) => i.type),
    );
    check(
      inputs.join(",") === "email,password",
      `[${width}] sign-up asks for an email and a password only`,
    );
    check(await noSideways(page), `[${width}] sign-up: no sideways scroll`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-up"), { timeout: 60_000 });
    check(true, `[${width}] signed up (${new URL(page.url()).pathname})`);

    execFileSync("psql", [
      database!,
      "-c",
      `UPDATE users SET onboarded_at = now(), username = 'screens${width}${Date.now() % 100000}' WHERE email = '${email}'`,
    ]);
    await ctx.clearCookies();
    await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main a")]
        .filter((e) => e.offsetParent)
        .map((e) => e.innerText.trim()),
    );
    check(
      labels.indexOf("Sign in with a passkey") < labels.indexOf("Sign in") &&
        labels.includes("Create an account"),
      `[${width}] sign-in is AccountKit's card, in its order`,
    );
    check(await noSideways(page), `[${width}] sign-in: no sideways scroll`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });

    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page
      .locator("main button:visible", { hasText: /^Account$/ })
      .first()
      .click();
    const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    for (const t of ["Ways to sign in", "Passkeys", "Two-factor sign-in", "Delete account"])
      check(text.includes(t), `[${width}] the account panel shows "${t}"`);
    check(await noSideways(page), `[${width}] settings: no sideways scroll`);
    await page.getByRole("button", { name: "Add a passkey" }).click();
    let count = 0;
    for (let i = 0; i < 20 && count === 0; i++) {
      await page.waitForTimeout(1000);
      count = (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length;
    }
    check(count === 1, `[${width}] a passkey is added from the panel`);

    await ctx.clearCookies();
    await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 });
    check(true, `[${width}] signed in with the passkey`);

    await page.goto(`${base}/forgot-password`, { waitUntil: "networkidle" });
    check(await noSideways(page), `[${width}] recovery: no sideways scroll`);
    check(
      errors.length === 0,
      `[${width}] no runtime errors${errors.length ? `: ${errors[0]}` : ""}`,
    );
    await ctx.close();
  }
  await browser.close();
  assert.equal(failed, 0, `${failed} check(s) failed`);
  console.log("✓ accountkit-screens-browser passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
