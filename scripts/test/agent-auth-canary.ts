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
import { authFailureMessage, detectAuthFailure } from "../../desktop/src/main/agent-auth";
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
  console.log("agent-auth-canary: ok");
} finally {
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
}
