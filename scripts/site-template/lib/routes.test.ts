import { describe, expect, it } from "vitest";
import { ROUTES, safeNext } from "./routes";

describe("safeNext", () => {
  it("keeps a path inside the site", () => {
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/de/roadmap?x=1")).toBe("/de/roadmap?x=1");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("refuses %s and falls back to the account page", (value) => {
    expect(safeNext(value)).toBe(ROUTES.account);
  });
});
