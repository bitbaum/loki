import { defineConfig } from "drizzle-kit";

// `pnpm run db:generate` writes a versioned migration into drizzle/ from
// lib/db/schema.ts (the schema is the SSOT for every table). The box's deploy
// applies new files forward-only and refuses destructive statements; review the
// SQL in the pull request.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/app" },
});
