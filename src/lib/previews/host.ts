/**
 * A preview's own address: <label>.orangecat.ch, so what a prospect is sent
 * reads like their own site and moving it to their domain later is the
 * ordinary attach-domain step. The box script
 * (scripts/hetzner/attach-preview-host.sh) is the authority; this only runs it
 * where the studio runs on the box, and says plainly when it cannot.
 *
 * Wildcard DNS already points every label here, so there is no record to set.
 */
import path from "path";
import { runAttachScript } from "@/lib/site-domain-attach";
import { probeRegisterSiteLocally } from "@/lib/site-cd-local";
import { previewHostUrl } from "@/lib/previews/address";

export type AttachPreviewHost = { ok: true; url: string } | { ok: false; reason: string };

export async function attachPreviewHost(label: string): Promise<AttachPreviewHost> {
  const ran = await runPreviewHostScript([label]);
  if (!ran.ok) return ran;
  return { ok: true, url: ran.liveUrl ?? previewHostUrl(label) };
}

/** Take a preview's address away (a moved preview's old one). */
export async function detachPreviewHost(
  label: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ran = await runPreviewHostScript([label, "--detach"]);
  return ran.ok ? { ok: true } : ran;
}

async function runPreviewHostScript(
  args: string[],
): Promise<{ ok: true; liveUrl: string | null } | { ok: false; reason: string }> {
  const probe = probeRegisterSiteLocally();
  if (!probe.ok || !probe.scriptPath || !probe.deployKeyPath) {
    return {
      ok: false,
      reason: probe.reason ?? "This server cannot change site addresses itself.",
    };
  }
  const script = path.join(path.dirname(probe.scriptPath), "attach-preview-host.sh");
  const ran = await runAttachScript(script, probe.deployKeyPath, args);
  if (ran.code !== 0)
    return { ok: false, reason: ran.output.trim().slice(-300) || "the address script failed" };
  return { ok: true, liveUrl: ran.liveUrl };
}

/**
 * Does the address answer over HTTPS? Any HTTP status counts (a preview with
 * no access code answers 503, with one 401): what must not happen is no TLS at
 * all, which is what a browser shows as ERR_SSL_PROTOCOL_ERROR. A fresh host
 * needs a few seconds for its certificate, so this waits.
 */
export async function waitForHost(url: string, totalMs = 45_000): Promise<boolean> {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    try {
      await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6_000), redirect: "manual" });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  return false;
}
