import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Needs DATABASE_URL pointing at a throwaway Postgres. CI provides one as a
// service container; locally: createdb app_test && DATABASE_URL=… pnpm run
// test:integration. It applies drizzle/ and drives sign-up and sign-in through
// the real auth handler.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
