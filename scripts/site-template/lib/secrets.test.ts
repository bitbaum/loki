import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canSeal, hintOf, open, seal, sealKey } from "./secrets";

const KEY = "k".repeat(48);

describe("seal / open", () => {
  const before = process.env.SECRET_SEAL_KEY;
  beforeEach(() => {
    process.env.SECRET_SEAL_KEY = KEY;
  });
  afterEach(() => {
    process.env.SECRET_SEAL_KEY = before;
  });

  it("round-trips, and the sealed form does not contain the secret", () => {
    const sealed = seal("sk-live-abcdef123456", "model-key:user-1");
    expect(sealed).not.toContain("abcdef");
    expect(open(sealed, "model-key:user-1")).toBe("sk-live-abcdef123456");
  });

  it("will not open under another context — a value copied to another row is useless", () => {
    const sealed = seal("secret", "model-key:user-1");
    expect(() => open(sealed, "model-key:user-2")).toThrow();
  });

  it("will not open a tampered value", () => {
    const sealed = seal("secret", "c");
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("00") ? "11" : "00");
    expect(() => open(tampered, "c")).toThrow();
  });

  it("refuses to seal without a long enough key", () => {
    process.env.SECRET_SEAL_KEY = "short";
    expect(canSeal()).toBe(false);
    expect(() => seal("x", "c")).toThrow();
  });
});

describe("sealKey", () => {
  it("needs 32 characters", () => {
    expect(sealKey({ SECRET_SEAL_KEY: "x".repeat(31) })).toBeNull();
    expect(sealKey({ SECRET_SEAL_KEY: "x".repeat(32) })).toBe("x".repeat(32));
    expect(sealKey({})).toBeNull();
  });
});

describe("hintOf", () => {
  it("shows the last four characters only", () => {
    expect(hintOf("sk-or-v1-1234567890abcd")).toBe("…abcd");
    expect(hintOf("")).toBe("");
  });
});
