import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Hermetic: no database, no network, no secrets. The integration suite that
// needs Postgres has its own config (vitest.integration.config.mts).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "i18n/**/*.test.ts", "*.test.ts"],
    exclude: ["**/*.integration.test.ts", "node_modules/**"],
  },
});
