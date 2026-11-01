// A real OrangeCat sign-in into a product on AccountKit, in a browser, for
// scripts/hetzner/accountkit-switch.sh prove. The throwaway OrangeCat account
// (OC_EMAIL, OC_PASSWORD) exists before this runs and is deleted after.
//
//   1. next-auth/react's signIn("orangecat"): the product answers with
//      OrangeCat's authorize URL, and sets its own state cookie.
//   2. OrangeCat asks the person to sign in, then to allow the product.
//   3. OrangeCat sends the browser back to the product's callback, which signs
//      the person in; the product's session reads back.
//
// Prints only the product's user id (for the cleanup), on stdout. The log is
// public: nothing here prints an address, a password or a token.
import { chromium } from "playwright";

const { DOMAIN, OC_EMAIL, OC_PASSWORD } = process.env;
if (!DOMAIN || !OC_EMAIL || !OC_PASSWORD) {
  console.error("the domain and the throwaway OrangeCat account are required");
  process.exit(2);
}
const site = `https://${DOMAIN}`;
const step = (message) => console.error(`oidc: ${message}`);

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  const started = await context.request.post(`${site}/api/auth/signin/orangecat`, {
    headers: { origin: site },
    form: { csrfToken: "accountkit", callbackUrl: `${site}/` },
  });
  const { url } = await started.json();
  if (!url?.startsWith("https://orangecat.ch/oauth/authorize")) {
    throw new Error("the product did not start an OrangeCat sign-in");
  }
  step("the product's OrangeCat button reaches OrangeCat");

  await page.goto(url);
  await page.waitForURL(/orangecat\.ch\/auth/, { timeout: 30_000 });
  await page.locator("#email").fill(OC_EMAIL);
  await page.locator("#password").fill(OC_PASSWORD);
  await page.locator("#password").press("Enter");
  step("signed in at OrangeCat");

  // A first sign-in asks for consent; a remembered grant goes straight back.
  const back = new RegExp(`^${site.replace(/[.]/g, "\\.")}/`);
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  await Promise.race([
    page.waitForURL(back, { timeout: 45_000 }),
    allow.waitFor({ timeout: 45_000 }).then(async () => {
      step("OrangeCat asks for consent; allowing");
      await allow.click();
      await page.waitForURL(back, { timeout: 45_000 });
    }),
  ]);
  const landed = new URL(page.url());
  // Error codes carry no personal data; they say which check refused. The
  // product's own code comes first, better-auth's reason after it.
  const refusal = [
    ...landed.searchParams.getAll("error"),
    ...landed.searchParams.getAll("error_description"),
  ].join(" ");
  if (refusal) throw new Error(`the product refused the OrangeCat callback: ${refusal}`);
  step("back in the product");

  const session = await (await context.request.get(`${site}/api/auth/session`)).json();
  if (!session?.user?.id) throw new Error("the product's session did not read back");
  step("the product's session reads back");
  process.stdout.write(String(session.user.id));
} catch (error) {
  console.error(`oidc: failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
