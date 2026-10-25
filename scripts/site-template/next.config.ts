import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { SECURITY_HEADERS } from "./lib/security";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * The commit this build was made from, so /api/health can say what production
 * runs (the auto-merge sweep's reconciler compares it to main). The deploy
 * builds inside GitHub Actions, where GITHUB_SHA is set; a local build asks
 * git; anything else is reported as unknown, never guessed.
 */
function buildCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  // The box's launch.sh starts the standalone server.js.
  output: "standalone",
  reactStrictMode: true,
  outputFileTracingIncludes: { "/*": ["./content/blog/**/*"] },
  // Nothing to gain from telling the internet which framework this is.
  poweredByHeader: false,
  env: { BUILD_COMMIT: buildCommit() },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Nothing an API answers — a session, a setting, a model's reply — may
      // sit in a shared cache.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
