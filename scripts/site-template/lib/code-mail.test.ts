import { describe, expect, it } from "vitest";
import { authMail, renderAuthMail } from "./mail";
import { SITE } from "@/lib/site";

describe("the sign-in code in the sign-in link's email", () => {
  const link = `${SITE.url}/api/auth/magic-link/verify?token=t&callbackURL=%2Fde%2Faccount`;

  it("is printed in the reader's language, in the text and the HTML", () => {
    const mail = renderAuthMail("magicLink", link, "de", "123456");
    expect(mail.text).toContain("123 456");
    expect(mail.html).toContain("123 456");
    expect(mail.text).toContain("Gerät");
  });

  it("is left out when there is none, and the shared mailer says it prints one", () => {
    expect(renderAuthMail("magicLink", link, "en").text).not.toMatch(/\d{3} \d{3}/);
    expect(authMail.codes).toBe(true);
  });
});
