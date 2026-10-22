"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Plus, Trash2, Loader2, Terminal, ExternalLink, Cpu } from "lucide-react";
import { postJson, deleteJson } from "@/lib/api/fetch";
import { APP_URL } from "@/config/brand";
import { FEEDBACK_MEDIUM_MS } from "@/lib/constants/timings";
// Window.fleetRunner type lives in src/components/desktop/types.ts (the
// canonical SSOT for the IPC bridge). Importing the side-effects of that
// module pulls in the declare-global so we can use window.fleetRunner here.
import "@/components/desktop/types";
import { useInsideFleetRunner } from "@/hooks/use-inside-fleet-runner";

type TokenMeta = {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
  prefix?: string;
};

type NewToken = { token: string; id: string; label: string };

export function AgentTokenSettings() {
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [revealed, setRevealed] = useState<NewToken | null>(null);
  // "auto-pair" state — when the React tree runs inside Fleet Runner,
  // we hand any newly-minted token straight to the desktop runner over
  // IPC. The UI replaces the "Open in Fleet Runner" deep-link button
  // with a confirmation chip so the user knows it already paired.
  const insideFleetRunner = useInsideFleetRunner();
  const [autoPaired, setAutoPaired] = useState<{ tokenId: string } | null>(null);
  const [autoPairError, setAutoPairError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agent-tokens")
      .then((r) => r.json())
      .then((d: { tokens?: TokenMeta[] }) => setTokens(d.tokens ?? []))
      .catch(() => {});
  }, []);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const interactiveInitCommand = `curl -fsSL ${APP_URL}/api/agent/install | node - init --base-url ${APP_URL}`;

  const create = async () => {
    if (!label.trim()) return;
    setCreating(true);
    setError("");
    setAutoPaired(null);
    setAutoPairError(null);
    try {
      const res = await postJson("/api/agent-tokens", { label: label.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create token");
      setRevealed({ token: data.token, id: data.id, label: data.label });
      setTokens((prev) => [
        ...prev,
        {
          id: data.id,
          label: data.label,
          lastUsedAt: null,
          createdAt: data.createdAt,
          prefix: data.prefix,
        },
      ]);
      setLabel("");
      // If we're inside Fleet Runner, hand the new token straight to the
      // desktop runner over IPC. The user gets paired in one click instead
      // of the 3-step "copy → close → paste" deep-link dance.
      // Every method on FleetRunnerBridge is typed optional (older shipped
      // desktop builds may lack newer methods), so check before invoking.
      if (typeof window !== "undefined" && window.fleetRunner?.saveToken) {
        try {
          const saveRes = await window.fleetRunner.saveToken(data.token);
          if (saveRes?.ok) {
            setAutoPaired({ tokenId: data.id });
          } else {
            setAutoPairError(saveRes?.error ?? "Token saved on server but Fleet Runner refused it");
          }
        } catch (ipcErr) {
          setAutoPairError(ipcErr instanceof Error ? ipcErr.message : "Fleet Runner IPC failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  };

  // Per-key copy feedback so multiple Copy buttons in the same view can each
  // show their own check-mark without stealing the others' state.
  const copy = async (text: string, key: string = "default") => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(
      () => setCopiedKey((current) => (current === key ? null : current)),
      FEEDBACK_MEDIUM_MS,
    );
  };

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      await deleteJson("/api/agent-tokens", { id });
      setTokens((prev) => prev.filter((t) => t.id !== id));
      if (revealed?.id === id) setRevealed(null);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="ui-settings-section">
      <h2 className="font-medium text-text-primary">Your computer</h2>
      <p className="text-sm text-text-tertiary">
        To let agents work on your own computer, install the{" "}
        <a href="/download" className="underline">
          Fleet Runner app
        </a>
        . On a machine with no screen, the command below does the same.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs text-text-secondary">
          {interactiveInitCommand}
        </code>
        <button
          onClick={() => copy(interactiveInitCommand, "install")}
          className="ui-icon-action shrink-0 min-h-8 min-w-8 p-1.5"
          title="Copy install command"
        >
          {copiedKey === "install" ? (
            <Check className="h-4 w-4 text-status-positive" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Token creation form */}
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Label, e.g. macbook-pro"
          className="ui-input flex-1"
        />
        <button
          onClick={create}
          disabled={creating || !label.trim()}
          className="ui-btn-secondary gap-1.5 whitespace-nowrap"
        >
          {creating ? <Loader2 className="ui-spinner-sm" /> : <Plus className="h-3.5 w-3.5" />}
          Generate
        </button>
      </div>

      {error && <p className="ui-error">{error}</p>}

      {/* One-time reveal */}
      {revealed && (
        <div className="ui-callout-positive flex-col items-stretch gap-2">
          <p className="text-xs font-medium text-status-positive">
            Token generated — copy it now. It won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface-base px-3 py-2 font-mono text-xs text-text-primary">
              {revealed.token}
            </code>
            <button
              onClick={() => copy(revealed.token, "token")}
              className="ui-icon-action shrink-0 min-h-8 min-w-8 p-1.5"
              title="Copy token"
            >
              {copiedKey === "token" ? (
                <Check className="h-4 w-4 text-status-positive" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          {/* Three branches based on the running surface:
              1. Inside Fleet Runner + auto-pair succeeded → confirmation chip.
              2. Inside Fleet Runner + auto-pair failed → "Retry" button.
              3. In a regular browser → deep-link to hand the token to the
                 desktop app via the loki:// protocol. */}
          {insideFleetRunner && autoPaired?.tokenId === revealed.id ? (
            <div className="self-start inline-flex items-center gap-1.5 rounded-md bg-status-positive-subtle px-3 py-1.5 text-xs text-status-positive">
              <Cpu className="h-3.5 w-3.5" />
              <span>Paired with this computer. It is connecting now.</span>
            </div>
          ) : insideFleetRunner ? (
            <div className="space-y-1 self-start">
              <button
                type="button"
                onClick={async () => {
                  if (!revealed) return;
                  const save = window.fleetRunner?.saveToken;
                  if (!save) {
                    setAutoPairError(
                      "This Fleet Runner build is missing the saveToken IPC — update to v0.2+",
                    );
                    return;
                  }
                  setAutoPairError(null);
                  try {
                    const r = await save(revealed.token);
                    if (r?.ok) setAutoPaired({ tokenId: revealed.id });
                    else setAutoPairError(r?.error ?? "Save failed");
                  } catch (e) {
                    setAutoPairError(e instanceof Error ? e.message : "IPC failed");
                  }
                }}
                className="ui-btn-primary gap-1.5 text-xs"
              >
                <Cpu className="h-3.5 w-3.5" />
                Pair with this Fleet Runner
              </button>
              {autoPairError && (
                <p className="text-xs text-status-warning">
                  Couldn&apos;t pair automatically: {autoPairError}. You can still copy the token
                  and paste it manually.
                </p>
              )}
            </div>
          ) : (
            <>
              <a
                href={`loki://auth?token=${encodeURIComponent(revealed.token)}`}
                className="ui-btn-primary self-start gap-1.5 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Fleet Runner
              </a>
              <p className="text-xs text-text-tertiary">
                Requires Fleet Runner v0.2 or newer installed.{" "}
                <a href="/download" className="underline">
                  Get it here
                </a>
                .
              </p>
            </>
          )}
          <p className="text-xs text-text-tertiary flex items-center gap-1">
            <Terminal className="h-3 w-3 shrink-0" />
            Or one-shot install (token pre-filled, no prompt):
          </p>
          {(() => {
            const oneShot = `curl -fsSL ${APP_URL}/api/agent/install | node - init --token ${revealed.token} --base-url ${APP_URL}`;
            return (
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-surface-base px-3 py-2 font-mono text-xs text-text-primary">
                  {oneShot}
                </code>
                <button
                  onClick={() => copy(oneShot, "oneshot")}
                  className="ui-icon-action shrink-0 min-h-8 min-w-8 p-1.5"
                  title="Copy install command with token pre-filled"
                >
                  {copiedKey === "oneshot" ? (
                    <Check className="h-4 w-4 text-status-positive" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Token list */}
      {tokens.length > 0 && (
        <div className="space-y-1.5">
          {tokens.map((t) => (
            <div key={t.id} className="ui-card-shell flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate text-sm font-medium text-text-primary">{t.label}</p>
                  {t.prefix && (
                    <code
                      className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-micro text-text-tertiary shrink-0"
                      title="Token prefix — match this against the ck_… in your .env to identify the right token"
                    >
                      {t.prefix}
                    </code>
                  )}
                </div>
                <p className="text-xs text-text-tertiary mt-0.5">
                  Created {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt
                    ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : " · never used"}
                </p>
              </div>
              <button
                onClick={() => remove(t.id)}
                disabled={deleting === t.id}
                className="ui-icon-action shrink-0 min-h-8 min-w-8 p-1.5 text-status-negative/60 hover:text-status-negative"
                title="Revoke token"
              >
                {deleting === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {tokens.length === 0 && !revealed && (
        <p className="text-sm text-text-secondary">
          No tokens yet. Generate one to connect an agent.
        </p>
      )}
    </section>
  );
}
