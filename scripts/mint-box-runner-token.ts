/**
 * Provision a runner token for a headless box-runner unit and write it
 * directly to the token file — the box-runner equivalent of the desktop
 * "install runner" flow. Mints a fresh ck_ token (never an existing user
 * secret), so it can be revoked independently from Settings.
 *
 * Usage (run where DATABASE_URL is set — the app host, never inside a
 * tenant's unit):
 *   tsx scripts/mint-box-runner-token.ts [outPath] [--user <userId>]
 * Default outPath = ~/.config/loki/fleet-runner-token (token-store's path).
 * Without --user the token is the owner's (the `loki` entity's owner); with
 * it, one tenant's — their unit then claims only their own account's work
 * (docs/architecture/private-builders.md).
 *
 * Prints the userId + token PREFIX only (never the full token).
 */
import fs from "fs";
import path from "path";
import os from "os";
import { createAgentToken } from "@/db/queries/agent-tokens";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { getUserById } from "@/db/queries/users";

function readArgs(argv: string[]): { outPath: string; userId: string | null } {
  const rest: string[] = [];
  let userId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") userId = argv[++i]?.trim() || null;
    else rest.push(argv[i]);
  }
  return {
    outPath: rest[0] || path.join(os.homedir(), ".config", "loki", "fleet-runner-token"),
    userId,
  };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const target = args.userId ? { userId: args.userId } : await getSelfImprovementTarget();
  if (!target) {
    console.error("[mint] no owner found (no 'loki' entity). Aborting.");
    process.exit(1);
  }
  const user = await getUserById(target.userId).catch(() => null);
  if (args.userId && !user) {
    console.error(`[mint] no user ${args.userId}. Aborting.`);
    process.exit(1);
  }
  const outPath = args.outPath;

  const { token } = await createAgentToken(target.userId, "box-runner");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, token, { mode: 0o600 });
  fs.chmodSync(outPath, 0o600);

  console.log(
    `[mint] wrote box-runner token ${token.slice(0, 9)}… for user ${target.userId}` +
      `${user?.email ? ` (${user.email})` : ""} → ${outPath}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[mint] failed:", e);
  process.exit(1);
});
