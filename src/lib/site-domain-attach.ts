/**
 * A site's own domain — the I/O half: look DNS up, run attach-domain.sh on
 * the box, record the new address.
 *
 * Same trust model as registration (site-cd-register.ts): the box script is
 * the authority and runs only in the studio process on the box, for accounts
 * the shared box serves. Anyone else is given the command, never a pretend
 * success.
 */
import path from "path";
import { spawn } from "child_process";
import { resolve4, resolve6 } from "dns/promises";
import { setProjectLiveUrl } from "@/db/queries/atlas";
import { upsertEntityAttribute } from "@/db/queries/utils";
import { getActiveWidgetToken, upsertWidgetToken } from "@/db/queries/widget-tokens";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { probeRegisterSiteLocally, studioDevRoot, studioRepoRoot } from "@/lib/site-cd-local";
import { siteCdLiveUrl } from "@/lib/site-cd";
import {
  attachDomainCommand,
  dnsRecordsFor,
  dnsVerdict,
  type DnsRecord,
  type DnsVerdict,
} from "@/lib/site-domain";

async function lookup(domain: string): Promise<{ a: string[]; aaaa: string[] }> {
  // resolve4/6 follow CNAMEs, like the script's getent: www → <slug>.<base> →
  // the box counts as pointing here.
  const [a, aaaa] = await Promise.all([
    resolve4(domain).catch(() => [] as string[]),
    resolve6(domain).catch(() => [] as string[]),
  ]);
  return { a, aaaa };
}

export type OwnDomainCheck = {
  domain: string;
  records: DnsRecord[];
  verdict: DnsVerdict;
};

/** Which records to set, and whether they are set yet. Changes nothing. */
export async function checkOwnDomain(domain: string, slug: string): Promise<OwnDomainCheck> {
  return {
    domain,
    records: dnsRecordsFor(domain, slug),
    verdict: dnsVerdict(domain, await lookup(domain)),
  };
}

export type OwnDomainResult =
  | { status: "attached" | "detached"; liveUrl: string; certificatePending: boolean }
  | { status: "dns-not-ready"; check: OwnDomainCheck }
  | { status: "needs-operator"; command: string; reason: string }
  | { status: "failed"; reason: string; command: string };

/** attach-domain.sh's last line is LIVE_URL=<url>; exit codes in its header. */
function runAttachScript(
  scriptPath: string,
  deployKeyPath: string,
  args: string[],
): Promise<{ code: number | null; output: string; liveUrl: string | null }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args], {
      detached: true,
      env: {
        ...process.env,
        LOKI_REPO_ROOT: studioRepoRoot(),
        DEV_ROOT: studioDevRoot(),
        DEPLOY_KEY_PATH: deployKeyPath,
      },
      cwd: path.dirname(path.dirname(scriptPath)),
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    // sync-infra plus up to a minute of waiting for the certificate.
    const timeout = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }
    }, 150_000);
    const done = (code: number | null) => {
      clearTimeout(timeout);
      const m = output.match(/^LIVE_URL=(\S+)$/m);
      resolve({ code, output, liveUrl: m?.[1] ?? null });
    };
    child.on("error", (err) => {
      output += String(err);
      done(null);
    });
    child.on("close", done);
  });
}

/**
 * Attach `domain` (or, with null, go back to the free address) and record
 * the result as the project's live URL. The widget's origin allowlist is
 * widened to the new address — a union, never a replacement, the same rule
 * widget-token/install follows — or its feedback would stop at the new host.
 */
export async function setOwnDomain(input: {
  userId: string;
  entityProjectId: string;
  userProjectId: string;
  slug: string;
  domain: string | null;
  cloudBuilderAllowed: boolean;
}): Promise<OwnDomainResult> {
  const command = attachDomainCommand(input.slug, input.domain);

  if (input.domain) {
    const check = await checkOwnDomain(input.domain, input.slug);
    if (!check.verdict.ready) return { status: "dns-not-ready", check };
  }

  if (!input.cloudBuilderAllowed) {
    return {
      status: "needs-operator",
      command,
      reason: "Sites on the shared server are connected by the studio. Run this on the server:",
    };
  }
  const probe = probeRegisterSiteLocally();
  const scriptPath = probe.scriptPath
    ? path.join(path.dirname(probe.scriptPath), "attach-domain.sh")
    : null;
  if (!probe.ok || !scriptPath || !probe.deployKeyPath) {
    return {
      status: "needs-operator",
      command,
      reason: probe.reason ?? "This server cannot change site addresses itself. Run:",
    };
  }

  const ran = await runAttachScript(
    scriptPath,
    probe.deployKeyPath,
    input.domain ? [input.slug, input.domain] : [input.slug, "--detach"],
  );
  if (ran.code === 3 && input.domain) {
    // DNS changed between our look and the script's (or resolvers disagree).
    return { status: "dns-not-ready", check: await checkOwnDomain(input.domain, input.slug) };
  }
  const liveUrl =
    ran.liveUrl ?? (input.domain ? `https://${input.domain}` : siteCdLiveUrl(input.slug));
  if (ran.code !== 0 && ran.code !== 4) {
    return { status: "failed", reason: ran.output.trim().slice(-400), command };
  }

  // Exit 4 still changed the address: the free host already forwards to the
  // new one, so the new one is where the site is — its certificate is late.
  await setProjectLiveUrl(input.userId, input.userProjectId, liveUrl);
  await upsertEntityAttribute(
    input.userId,
    input.entityProjectId,
    PROJECT_ATTR.PRODUCTION_URL,
    liveUrl,
  );
  if (input.domain) await widenWidgetOrigins(input.userId, input.entityProjectId, input.domain);

  return {
    status: input.domain ? "attached" : "detached",
    liveUrl,
    certificatePending: ran.code === 4,
  };
}

async function widenWidgetOrigins(userId: string, projectId: string, domain: string) {
  const token = await getActiveWidgetToken(userId, projectId).catch(() => null);
  // An empty list means "no restriction"; leave it that way.
  if (!token?.origins?.length) return;
  const add = [`https://${domain}`];
  if (!domain.startsWith("www.")) add.push(`https://www.${domain}`);
  const origins = [...new Set([...token.origins, ...add])];
  if (origins.length !== token.origins.length) {
    await upsertWidgetToken(userId, projectId, { origins }).catch(() => null);
  }
}
