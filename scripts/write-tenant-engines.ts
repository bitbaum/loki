/**
 * Write each private builder's engine keys into its unit env file.
 *
 * Runs ON the box as root (reconcile-tenants.sh, every minute), with the
 * database and BYOK_SEAL_SECRET from the app's env — the two things a tenant
 * unit never holds. For every account with users.private_builder it opens
 * the keys that account marked "also for building" (user_model_keys
 * .for_building, Settings → Your engine) and writes them as the agent CLIs'
 * own variables (config/build-engines.ts) to /etc/loki/runners/<short>.env,
 * root-owned, mode 0600, which systemd reads into that tenant's unit and
 * the agent environment allowlist lets through (agent-env.ts). Nothing else
 * goes into that file. Prints the short id of every tenant whose file
 * changed, one per line, so the caller can drain-restart just those units.
 *
 *   tsx scripts/write-tenant-engines.ts [--dir /etc/loki/runners]
 */
import fs from "fs";
import path from "path";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listBuildEngineKeys } from "@/db/queries/user-model-keys";
import { tenantShortId } from "@/lib/agent-execution/box-workspace-path";
import { renderEnvFile } from "@/lib/tenant-engines-env";
import { resolveRunEngine } from "@/lib/build-engine/resolve";
import { LOKI_BUILD_ENGINE_KEY_VAR } from "@/config/welcome-changes";

function readArgs(argv: string[]): { dir: string } {
  const i = argv.indexOf("--dir");
  return { dir: i >= 0 && argv[i + 1] ? argv[i + 1] : "/etc/loki/runners" };
}

async function main(): Promise<void> {
  const { dir } = readArgs(process.argv.slice(2));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tenants = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privateBuilder, true));
  // Loki's own key, for a tenant who chose Loki's engine and still has builds
  // on it (lib/build-engine/resolve.ts). Set in the app's env on the box; a
  // server without it has no Loki engine, and the settings screen says so.
  const lokiKey = process.env[LOKI_BUILD_ENGINE_KEY_VAR]?.trim() || null;
  for (const t of tenants) {
    const short = tenantShortId(t.id);
    const file = path.join(dir, `${short}.env`);
    const engine = await resolveRunEngine(t.id);
    const keys =
      engine.choice === "loki"
        ? engine.ok && lokiKey
          ? [{ env: "ANTHROPIC_API_KEY", value: lokiKey }]
          : []
        : await listBuildEngineKeys(t.id);
    const next = renderEnvFile(keys);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (prev === next) continue;
    fs.writeFileSync(`${file}.tmp`, next, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    fs.chmodSync(file, 0o600);
    console.log(short);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[tenant-engines] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
