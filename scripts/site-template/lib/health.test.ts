import { describe, expect, it } from "vitest";
import { buildCommit, probeDatabase, summarise } from "./health";

describe("summarise", () => {
  const base = { commit: null, accounts: true, mail: false, ai: false } as const;

  it("is healthy only when the database answers and accounts work", () => {
    expect(summarise({ ...base, db: "up" }).ok).toBe(true);
    expect(summarise({ ...base, db: "down" }).ok).toBe(false);
    expect(summarise({ ...base, db: "unconfigured" }).ok).toBe(false);
    expect(summarise({ ...base, db: "up", accounts: false }).ok).toBe(false);
  });

  it("does not need mail or a model to be healthy", () => {
    expect(summarise({ ...base, db: "up", mail: false, ai: false }).ok).toBe(true);
  });

  it("carries no secret-shaped field", () => {
    const keys = Object.keys(summarise({ ...base, db: "up" }));
    expect(keys.filter((k) => /key|secret|token|url|password/i.test(k))).toEqual([]);
  });
});

describe("probeDatabase", () => {
  it("says unconfigured, not down, when there is no database", async () => {
    const before = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    await expect(probeDatabase()).resolves.toBe("unconfigured");
    process.env.DATABASE_URL = before;
  });
});

describe("buildCommit", () => {
  it("reports a full sha and nothing else", () => {
    expect(buildCommit("a".repeat(40))).toBe("a".repeat(40));
    expect(buildCommit("main")).toBeNull();
    expect(buildCommit("")).toBeNull();
    expect(buildCommit(undefined)).toBeNull();
  });
});
