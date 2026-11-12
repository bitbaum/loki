/**
 * The auth canary only fails a run on THIS run's evidence.
 *
 * 2026-11-12: a fresh `solon` tab on the cloud runner was failed as "claude is
 * not authenticated" because the newest Claude transcript in that folder was a
 * two-day-old session ending "Please run /login". A Grok run a minute later was
 * failed with the same Claude text, because the canary read Claude's folder for
 * an agent that never writes there. The runner's sign-ins were fine.
 *
 * Run: npx tsx scripts/test/agent-auth-canary.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  authFailureMessage,
  claudeReportedCapacityWall,
  detectAuthFailure,
} from "../../desktop/src/main/agent-auth";
import { capacityFailureFromScreen } from "../../desktop/src/main/pty-runtime";
import { claudeProjectSlug } from "@/lib/usage/claude-transcript-usage";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "auth-canary-"));
const prevHome = process.env.HOME;
process.env.HOME = home;
try {
  const dir = "/home/ubuntu/dev/solon";
  const projDir = path.join(home, ".claude", "projects", claudeProjectSlug(dir));
  fs.mkdirSync(projDir, { recursive: true });
  const old = path.join(projDir, "old-session.jsonl");
  fs.writeFileSync(
    old,
    JSON.stringify({
      type: "assistant",
      text: "Login reached its time limit · Please run /login",
    }) + "\n",
  );
  const twoDaysAgo = (Date.now() - 2 * 86_400_000) / 1000;
  fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
  const sentAt = Date.now();

  // Without a send time, the old behaviour stays (the tail says /login).
  assert(detectAuthFailure(dir) === true, "no `since`: the newest transcript is still read");
  // An old session's /login is not this run's failure.
  assert(
    detectAuthFailure(dir, { agent: "claude", since: sentAt }) === false,
    "a transcript last written before the prompt must not fail the run",
  );
  // This run's own log saying /login is.
  const fresh = path.join(projDir, "new-session.jsonl");
  fs.writeFileSync(
    fresh,
    JSON.stringify({ type: "assistant", text: "401 Invalid authentication credentials" }) + "\n",
  );
  assert(
    detectAuthFailure(dir, { agent: "claude", since: sentAt }) === true,
    "this run's own transcript with a 401 must fail the run",
  );

  // Grok never reads Claude's folder: the 401 transcript above is not its.
  assert(
    detectAuthFailure(dir, {
      agent: "grok",
      since: sentAt,
      screen: "Working… reading README.md",
    }) === false,
    "grok must not be failed by a Claude transcript",
  );
  assert(
    detectAuthFailure(dir, {
      agent: "grok",
      since: sentAt,
      screen: "Error: not logged in. Run `grok login`.",
    }) === true,
    "grok saying it is not logged in must fail the run",
  );
  // The prompt's own words are not the agent's answer.
  const prompt = "If you see 'login required' on the box, report it.";
  assert(
    detectAuthFailure(dir, { agent: "grok", screen: `> ${prompt}\nOn it.`, prompt }) === false,
    "words echoed from the prompt must not count",
  );

  // Each agent gets its own fix; only Claude's names CLAUDE_CODE_OAUTH_TOKEN.
  assert(
    authFailureMessage("claude").includes("CLAUDE_CODE_OAUTH_TOKEN"),
    "claude message names its token",
  );
  assert(
    !authFailureMessage("grok").includes("CLAUDE_CODE_OAUTH_TOKEN"),
    "grok message must not name Claude's token",
  );
  assert(
    authFailureMessage("grok").startsWith("grok is not authenticated"),
    "grok message names grok",
  );
  assert(
    !authFailureMessage("gemini").includes(".claude"),
    "gemini message must not name Claude's files",
  );
  // Quota: only Claude's own API error entry since the prompt is a wall.
  const capDir = "/home/ubuntu/dev/capacity";
  const capProj = path.join(home, ".claude", "projects", claudeProjectSlug(capDir));
  fs.mkdirSync(capProj, { recursive: true });
  const capSent = Date.now() - 500;
  const brief =
    "Replace the in-memory per-process rate limiter. Per-process memory resets on deploy.";
  const log = path.join(capProj, "s.jsonl");
  fs.writeFileSync(
    log,
    JSON.stringify({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { content: brief },
    }) +
      "\n" +
      JSON.stringify({
        type: "assistant",
        timestamp: new Date().toISOString(),
        message: { content: [{ type: "text", text: "Replacing the rate limiter now." }] },
      }) +
      "\n",
  );
  assert(
    !claudeReportedCapacityWall(capDir, capSent),
    "our brief and Claude's prose about rate limits are not a wall",
  );
  fs.appendFileSync(
    log,
    JSON.stringify({
      type: "assistant",
      isApiErrorMessage: true,
      timestamp: new Date().toISOString(),
      message: {
        content: [
          { type: "text", text: "Claude usage limit reached. Your limit will reset at 9am." },
        ],
      },
    }) + "\n",
  );
  assert(claudeReportedCapacityWall(capDir, capSent), "Claude's own usage-limit error is a wall");
  assert(
    !claudeReportedCapacityWall(capDir, Date.now() + 60_000),
    "a wall from before the prompt is not this run's",
  );

  // The screen echo of our own brief, spaces lost in a redraw, is not a wall.
  assert(
    capacityFailureFromScreen(
      "Replacethein-memoryper-processratelimiter.Per-processmemoryresetsondeploy.",
      "grok",
      brief,
    ) === null,
    "a redraw of our own brief must not read as a quota wall",
  );
  assert(
    capacityFailureFromScreen("Error: usage limit reached, resets in 3h", "grok", brief) !== null,
    "the agent's own wall still counts",
  );

  console.log("agent-auth-canary: ok");
} finally {
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
}
