"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { deleteJson, postJson } from "@/lib/api/fetch";
import type { DnsRecord, DnsVerdict } from "@/lib/site-domain";

type Check = { domain: string; records: DnsRecord[]; verdict: DnsVerdict };
type Reply = {
  ok?: boolean;
  error?: string;
  status?: string;
  liveUrl?: string;
  certificatePending?: boolean;
  check?: Check;
  command?: string;
  reason?: string;
};

/**
 * Give a live site its own domain (evig.orangecat.ch → evig.ch), or take it
 * back to the free one. One field, the records to set, one button — and when
 * the records are not set yet, the panel says exactly which ones, so the
 * owner is never left at "it didn't work".
 */
export function OwnDomainButton({
  projectId,
  ownDomain,
  freeHost,
}: {
  projectId: string;
  /** The own domain the site is on now, if any. */
  ownDomain: string | null;
  /** The free address it falls back to, if it has one. */
  freeHost: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<"check" | "connect" | "detach" | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReply(null);
  };

  async function call(kind: "check" | "connect" | "detach") {
    setBusy(kind);
    setReply(null);
    try {
      const res =
        kind === "check"
          ? await fetch(`/api/projects/${projectId}/domain?domain=${encodeURIComponent(domain)}`)
          : kind === "connect"
            ? await postJson(`/api/projects/${projectId}/domain`, { domain })
            : await deleteJson(`/api/projects/${projectId}/domain`);
      const json = (await res.json().catch(() => ({}))) as Reply;
      setReply(res.ok ? json : { ...json, error: json.error ?? `HTTP ${res.status}` });
      if (json.status === "attached" || json.status === "detached") router.refresh();
    } catch {
      setReply({ error: "Network error — check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const check = reply?.check;
  return (
    <>
      <button
        type="button"
        className="ui-btn-ghost min-h-11 gap-1.5"
        onClick={() => setOpen(true)}
        title="Use a domain you own for this site"
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        {ownDomain ?? "Own domain"}
      </button>

      {open && (
        <Modal onClose={close} size="md" disableClose={busy !== null}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Your own domain</div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="p-1 text-text-tertiary hover:text-text-secondary rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {ownDomain ? (
            <p className="text-sm text-text-secondary">
              This site is at <strong>{ownDomain}</strong>.
              {freeHost && ` ${freeHost} forwards there.`} To move to another domain, type it below.
            </p>
          ) : (
            <p className="text-sm text-text-secondary">
              Bought a domain? Point it here and it becomes this site’s address
              {freeHost && <> — {freeHost} keeps working and forwards to it</>}. Nothing on the site
              mentions where it is hosted.
            </p>
          )}

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (domain.trim() && !busy) void call("check");
            }}
          >
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. evig.ch"
              autoFocus
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              className="ui-input min-w-0 flex-1"
              aria-label="Domain"
            />
            <button
              type="submit"
              className="ui-btn-secondary min-h-11"
              disabled={!domain.trim() || busy !== null}
            >
              {busy === "check" ? <Loader2 className="ui-spinner" /> : null}
              Check
            </button>
          </form>

          {check && (
            <div className="space-y-2">
              {check.verdict.ready ? (
                <div className="ui-box-success">
                  {check.domain} points here. Connect it to make it the site’s address.
                </div>
              ) : (
                <p className="text-sm text-text-secondary">{check.verdict.detail}</p>
              )}
              <div className="ui-micro-label">At your domain registrar</div>
              <div className="ui-code-surface overflow-x-auto whitespace-pre">
                {check.records.map((r) => `${r.type.padEnd(6)}${r.name}  →  ${r.value}`).join("\n")}
              </div>
              {check.verdict.ready && (
                <button
                  type="button"
                  className="ui-btn-submit"
                  onClick={() => void call("connect")}
                  disabled={busy !== null}
                >
                  {busy === "connect" ? (
                    <>
                      <Loader2 className="ui-spinner" /> Connecting — up to a minute…
                    </>
                  ) : (
                    <>Connect {check.domain}</>
                  )}
                </button>
              )}
            </div>
          )}

          {reply?.status === "attached" && reply.liveUrl && (
            <div className="ui-box-success">
              Done — the site is at{" "}
              <a href={reply.liveUrl} target="_blank" rel="noreferrer" className="underline">
                {reply.liveUrl}
              </a>
              .
              {reply.certificatePending &&
                " Its security certificate is still being issued; if the page does not open yet, try again in a few minutes."}
            </div>
          )}
          {reply?.status === "detached" && reply.liveUrl && (
            <div className="ui-box-success">The site is back at {reply.liveUrl}.</div>
          )}
          {reply?.status === "needs-operator" && (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">{reply.reason}</p>
              <div className="ui-code-surface">{reply.command}</div>
            </div>
          )}
          {reply?.error && <div className="ui-box-error">{reply.error}</div>}

          {ownDomain && freeHost && (
            <button
              type="button"
              className="ui-btn-ghost min-h-11 self-start"
              onClick={() => void call("detach")}
              disabled={busy !== null}
            >
              {busy === "detach" ? <Loader2 className="ui-spinner" /> : null}
              Go back to {freeHost}
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
