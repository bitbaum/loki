import { describe, expect, it } from "vitest";
import {
  isDeliverable,
  oidcClients,
  orangecatOidc,
  placeholderEmail,
  signinBroker,
  signInMethods,
  usableIssuer,
} from "./methods";

const BROKER = {
  SIGNIN_ISSUER: "https://signin.example.ch",
  SIGNIN_CLIENT_ID: "app",
  SIGNIN_CLIENT_SECRET: "s3cret",
};
const ORANGECAT = { ORANGECAT_OAUTH_CLIENT_ID: "app", ORANGECAT_OAUTH_CLIENT_SECRET: "s3cret" };

describe("signInMethods", () => {
  it("offers password and passkeys with no setup at all", () => {
    const methods = signInMethods({ NODE_ENV: "production" }, false);
    expect(methods).toMatchObject({ password: true, passkey: true, twoFactor: true });
  });

  it("hides every external button when its env is missing", () => {
    const methods = signInMethods({ NODE_ENV: "production" }, false);
    expect(methods.signin).toBe(false);
    expect(methods.orangecat).toBe(false);
  });

  it("hides the magic link in production without mail, and never strands a sign-up", () => {
    const methods = signInMethods({ NODE_ENV: "production" }, false);
    expect(methods.magicLink).toBe(false);
    expect(methods.verifyEmail).toBe(false);
  });

  it("offers the magic link and demands verification once mail works", () => {
    const methods = signInMethods({ NODE_ENV: "production" }, true);
    expect(methods.magicLink).toBe(true);
    expect(methods.verifyEmail).toBe(true);
  });

  it("prints the magic link locally in development", () => {
    expect(signInMethods({ NODE_ENV: "development" }, false).magicLink).toBe(true);
  });

  it("shows each OIDC button exactly when its three values are set", () => {
    expect(signInMethods({ ...BROKER }, false).signin).toBe(true);
    expect(signInMethods({ ...BROKER, SIGNIN_CLIENT_SECRET: " " }, false).signin).toBe(false);
    expect(signInMethods({ ...ORANGECAT }, false).orangecat).toBe(true);
    expect(signInMethods({ ORANGECAT_OAUTH_CLIENT_ID: "app" }, false).orangecat).toBe(false);
  });
});

describe("OIDC clients", () => {
  it("builds the discovery URL from the issuer", () => {
    expect(signinBroker(BROKER)?.discoveryUrl).toBe(
      "https://signin.example.ch/.well-known/openid-configuration",
    );
  });

  it("defaults OrangeCat to its public issuer", () => {
    expect(orangecatOidc(ORANGECAT)?.issuer).toBe("https://orangecat.ch");
    expect(
      orangecatOidc({ ...ORANGECAT, ORANGECAT_OAUTH_ISSUER: "https://oc.test/" })?.issuer,
    ).toBe("https://oc.test/");
  });

  it("refuses an issuer that is not https", () => {
    expect(signinBroker({ ...BROKER, SIGNIN_ISSUER: "http://signin.example.ch" })).toBeNull();
    expect(signinBroker({ ...BROKER, SIGNIN_ISSUER: "signin.example.ch" })).toBeNull();
    expect(usableIssuer("https://user:pw@x.ch")).toBeNull();
    expect(usableIssuer("http://localhost:3001")).toBe("http://localhost:3001");
  });

  it("lists the broker before OrangeCat", () => {
    expect(oidcClients({ ...BROKER, ...ORANGECAT }).map((c) => c.providerId)).toEqual([
      "bitbaum-signin",
      "orangecat",
    ]);
  });
});

describe("placeholderEmail", () => {
  it("can never receive mail and never repeats across providers", () => {
    const a = placeholderEmail("orangecat", "sub-1");
    expect(a).toMatch(/^[0-9a-f]{32}@orangecat\.invalid$/);
    expect(isDeliverable(a)).toBe(false);
    expect(placeholderEmail("bitbaum-signin", "sub-1")).not.toBe(a);
    expect(placeholderEmail("orangecat", "sub-1")).toBe(a);
  });

  it("does not reveal the subject", () => {
    expect(placeholderEmail("orangecat", "actor-42")).not.toContain("actor-42");
  });
});

describe("isDeliverable", () => {
  it("accepts a real address and refuses the rest", () => {
    expect(isDeliverable("person@example.ch")).toBe(true);
    expect(isDeliverable("x@y.INVALID")).toBe(false);
    expect(isDeliverable("")).toBe(false);
    expect(isDeliverable("no-at-sign")).toBe(false);
  });
});
