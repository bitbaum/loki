import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isRuntimeAvailable } from "@/lib/runtime";
import { checkEnv, envHealthy } from "@/lib/env";
import { getAIHealth } from "@/lib/ai/health";
import { APP_SLUG } from "@/config/brand";

/**
 * The commit this build was made from, stamped into the artifact by
 * `scripts/record-build-ref.sh` at build time so it rides every deploy path.
 *
 * Until this existed, nothing anywhere could say what production was running:
 * `version` below is `npm_package_version`, which is null under systemd. A
 * hand-run deploy ships whatever branch the worktree is on and has rolled prod
 * back three times; each time it presented as an application bug, because the
 * only way to check was to ssh in and grep the compiled bundle.
 *
 * Read once — the file cannot change without a restart, since a deploy rsyncs
 * then restarts. Absent (dev server, non-standalone build) is reported as null,
 * never guessed.
 */
const BUILD_COMMIT: string | null = (() => {
  for (const p of [".build-ref", ".next/standalone/.build-ref"]) {
    try {
      const sha = readFileSync(join(process.cwd(), p), "utf8").trim();
      if (sha) return sha;
    } catch {
      // Next candidate; a missing marker is a known state, not an error.
    }
  }
  return null;
})();

// force-dynamic: env read must happen at request time, not build time.
export const dynamic = "force-dynamic";

// Health + config gate. Returns 503 when the env sanity check finds a
// fatal/error issue, so the post-deploy assertion (and `npm run smoke`) go red
// instead of shipping a silently-broken auth/email config. Detailed issue
// messages are gated behind CRON_SECRET (the deploy has it); the public
// response is booleans only.
export async function GET(req: NextRequest) {
  const issues = checkEnv();
  const healthy = envHealthy(issues);
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authed = Boolean(cronSecret) && req.headers.get("authorization") === `Bearer ${cronSecret}`;

  return NextResponse.json(
    {
      ok: healthy,
      // WHICH app answered. Every app in the fleet serves /api/health from the
      // same template, so "it responded, and the payload has a commit field"
      // identifies a shape, not a product — and the pre-push smoke used
      // exactly that test. On 2026-09-22 it ran Loki's 48-route auth smoke
      // against a Heidi dev server that had claimed :3000 first, reported 23
      // routes returning 404, and blocked a push on a verdict about somebody
      // else's app. A name is cheap and cannot be mistaken for another one.
      app: APP_SLUG,
      runtime: isRuntimeAvailable(),
      version: process.env.npm_package_version ?? null,
      // The one field that answers "is prod running main?" without an ssh session.
      commit: BUILD_COMMIT,
      env: {
        healthy,
        issueCount: issues.length,
        ...(authed ? { issues } : {}),
      },
      // Informational only — NEVER folded into `healthy`/the status code below.
      // The chat/tool/vision chains in groq.ts, agent/llm.ts and vision.ts
      // already walk Groq -> OpenRouter on failure, so a dead vendor key can't
      // be fixed by restarting this app; gating the restart-decision on it
      // would just bounce a healthy app because someone else's key expired.
      // This exists purely so a chain that is quietly down (every link dead,
      // still answering with a caught error) shows up somewhere a human or a
      // monitor can see it, instead of only when a user complains.
      ai: getAIHealth(),
    },
    { status: healthy ? 200 : 503 },
  );
}
