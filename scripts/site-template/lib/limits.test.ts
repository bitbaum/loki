import { expect, it } from "vitest";
import { slidingWindow } from "limitkit";
import { tooMany } from "./limits";
it("app budget refusals preserve Retry-After and forbid caching", () => {
  const limiter = slidingWindow({ limit: 1, windowMs: 60_000 });
  limiter.check("test", 0);
  const response = tooMany(limiter.check("test", 1));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
