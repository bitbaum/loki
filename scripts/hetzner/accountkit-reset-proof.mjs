// A real password reset on a product on AccountKit, through a real inbox, for
// scripts/hetzner/accountkit-switch.sh prove. The throwaway account (EMAIL,
// with a password the box set) exists before this runs and is deleted after.
//
//   1. The product's own forgot-password page asks for a reset for EMAIL.
//   2. The mail arrives in a real inbox (mail.tm, read with MAILTM_TOKEN).
//   3. Its link opens the product's reset page; a new password is set there.
//   4. The new password signs in through the product's own sign-in route.
//
// The log is public: nothing here prints an address, a password, a link or
// a token.
import { chromium } from "playwright";

const { DOMAIN, FORGOT_PATH, PROVIDER, EMAIL, NEW_PASSWORD, MAILTM_TOKEN } = process.env;
if (!DOMAIN || !FORGOT_PATH || !PROVIDER || !EMAIL || !NEW_PASSWORD || !MAILTM_TOKEN) {
  console.error("the domain, its pages, and the throwaway account and inbox are required");
  process.exit(2);
}
const site = `https://${DOMAIN}`;
const step = (message) => console.error(`reset: ${message}`);
const mailtm = (path) =>
  fetch(`https://api.mail.tm${path}`, {
    headers: { authorization: `Bearer ${MAILTM_TOKEN}` },
  }).then((r) => r.json());

async function resetLink() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const list = await mailtm("/messages");
    const first = list["hydra:member"]?.[0];
    if (first) {
      const message = await mailtm(`/messages/${first.id}`);
      const text = [message.text ?? "", ...(message.html ?? [])].join("\n");
      const links = [...text.matchAll(/https:\/\/[^\s"'<>)\]]+/g)]
        .map((m) => m[0].replace(/&amp;/g, "&"))
        .filter((link) => new URL(link).host === DOMAIN);
      const link = links.find((l) => /reset|token|recover|password/i.test(l)) ?? links[0];
      if (!link) throw new Error("the mail arrived but carries no link to the product");
      return link;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error("no mail arrived within three minutes");
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${site}${FORGOT_PATH}`);
  const email = page.locator('input[type="email"]').first();
  await email.fill(EMAIL);
  await email.press("Enter");
  step("asked for a reset on the product's forgot-password page");

  const link = await resetLink();
  step("the reset mail arrived in a real inbox, with a link to the product");

  await page.goto(link);
  const passwords = page.locator('input[type="password"]');
  await passwords.first().waitFor({ timeout: 30_000 });
  const count = await passwords.count();
  for (let i = 0; i < count; i++) await passwords.nth(i).fill(NEW_PASSWORD);
  const answered = page.waitForResponse(
    (r) => r.request().method() !== "GET" && new URL(r.url()).host === DOMAIN,
    { timeout: 30_000 },
  );
  await passwords.nth(count - 1).press("Enter");
  const response = await answered;
  if (response.status() >= 400)
    throw new Error(`the reset page refused the new password (${response.status()})`);
  step("set a new password on the product's reset page");

  // A fresh browser: the new password signs in on its own.
  const fresh = await browser.newContext();
  const signedIn = await fresh.request.post(`${site}/api/auth/callback/${PROVIDER}`, {
    headers: { origin: site },
    form: {
      email: EMAIL,
      password: NEW_PASSWORD,
      csrfToken: "accountkit",
      callbackUrl: `${site}/`,
    },
  });
  const body = await signedIn.text();
  if (!body.includes('"url"') || body.includes("error="))
    throw new Error("the new password was refused");
  const session = await (await fresh.request.get(`${site}/api/auth/session`)).json();
  if (session?.user?.email?.toLowerCase() !== EMAIL.toLowerCase()) {
    throw new Error("the new password's session did not read back");
  }
  step("the new password signs in");
} catch (error) {
  console.error(`reset: failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
