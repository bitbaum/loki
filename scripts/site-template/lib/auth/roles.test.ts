import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE, isRole, isStaff, mayGrantRole, ROLES } from "./roles";

describe("roles", () => {
  it("starts everyone as a customer", () => {
    expect(DEFAULT_ROLE).toBe("customer");
    expect(ROLES).toContain(DEFAULT_ROLE);
  });

  it("knows only its own roles", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("gives staff powers to staff and admins only", () => {
    expect(ROLES.filter(isStaff)).toEqual(["staff", "admin"]);
    expect(isStaff("Admin")).toBe(false);
  });

  it("lets only an admin grant a role, and never to themselves", () => {
    expect(mayGrantRole({ id: "a", role: "admin" }, "b")).toBe(true);
    expect(mayGrantRole({ id: "a", role: "admin" }, "a")).toBe(false);
    expect(mayGrantRole({ id: "a", role: "staff" }, "b")).toBe(false);
  });
});
