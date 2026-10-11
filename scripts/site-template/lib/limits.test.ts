import { slidingWindow } from "limitkit";
import { describe, expect, it } from "vitest";
import { authBucket, callerKey, recipientKey, tooMany } from "./limits";

describe("authBucket", () => {
  it.each([
    ["/sign-up/email", "mail"],
    ["/sign-in/magic-link", "mail"],
    ["/request-password-reset", "mail"],
    ["/send-verification-email", "mail"],
    ["/sign-in/email", "credential"],
    ["/sign-in/social", "credential"],
    ["/two-factor/verify-totp", "credential"],
    ["/two-factor/verify-backup-code", "credential"],
    ["/passkey/verify-authentication", "credential"],
    ["/reset-password", "credential"],
    ["/get-session", "auth"],
    ["/sign-out", "auth"],
  ])("%s spends from %s", (path, bucket) => {
    expect(authBucket(path)).toBe(bucket);
  });
});

describe("callerKey", () => {
  it("keys on the hop the proxy appended, not on what the client typed", () => {
    const forged = (first: string) => new Headers({ "x-forwarded-for": `${first}, 203.0.113.7` });
    expect(callerKey(forged("1.1.1.1"), "s")).toBe("s:203.0.113.7");
    // A fresh forged value per request is still the same bucket.
    expect(callerKey(forged("9.9.9.9"), "s")).toBe(callerKey(forged("1.1.1.1"), "s"));
  });

  it("a hammered key is refused, and the refusal is a 429 that says when", () => {
    const limiter = slidingWindow({ limit: 2, windowMs: 60_000 });
    const key = callerKey(new Headers({ "x-forwarded-for": "203.0.113.9" }), "t");
    expect(limiter.check(key, 0).allowed).toBe(true);
    expect(limiter.check(key, 1).allowed).toBe(true);
    const refused = limiter.check(key, 2);
    expect(refused.allowed).toBe(false);
    const response = tooMany(refused);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});

describe("recipientKey", () => {
  it("is the same for one address however it is typed, and holds no address", () => {
    expect(recipientKey(" Person@Example.ch ")).toBe(recipientKey("person@example.ch"));
    expect(recipientKey("person@example.ch")).not.toContain("example");
  });
});
