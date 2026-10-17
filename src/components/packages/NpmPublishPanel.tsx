"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson } from "@/lib/api/fetch";
import { NPM_KEY_SETTINGS, NPM_NEW_KEY_URL } from "@/config/npm-publishing";
import type { FirstPublishResult } from "@/lib/packages/npm-publish-rules";

type NpmKeyState = {
  key: { npmUser: string | null; expiresAt: string | null; usable: boolean } | null;
  notOnNpm: string[];
};

const OUTCOME_WORDS: Record<FirstPublishResult["outcome"], string> = {
  started: "publishing now — on npm in a few minutes",
  "on-npm": "already on npm",
  waiting: "publish already running",
  "no-workflow": "its repository has no publish.yml yet",
  "not-yours": "not yours to publish",
  private: "marked private — never published",
  failed: "could not start",
};

/**
 * "npm" on /packages: one key from the owner, and Loki puts every package on
 * npm — the first version through the key, every later one through GitHub
 * with no key at all (src/lib/packages/npm-publish.ts).
 */
export function NpmPublishPanel() {
  const { data, refetch } = useFetch<NpmKeyState>("/api/packages/npm-key", { timeoutMs: 20_000 });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FirstPublishResult[] | null>(null);
  const [replacing, setReplacing] = useState(false);

  if (!data) return null;
  const saved = data.key?.usable ? data.key : null;
  if (!saved && data.notOnNpm.length === 0 && !results) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson("/api/packages/npm-key", { key: key.trim() });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: FirstPublishResult[];
      };
      if (!res.ok) throw new Error(body.error ?? "Could not save the key just now.");
      setResults(body.results ?? []);
      setKey("");
      setReplacing(false);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the key just now.");
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    setBusy(true);
    await deleteJson("/api/packages/npm-key").catch(() => null);
    setBusy(false);
    setResults(null);
    refetch();
  }

  const until = saved?.expiresAt
    ? new Date(saved.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })
    : null;

  return (
    <section className="ui-card-shell space-y-4 p-4" aria-labelledby="npm-panel-title">
      <div className="space-y-1">
        <h2 id="npm-panel-title" className="text-sm font-medium text-text-primary">
          npm
        </h2>
        {saved ? (
          <p className="text-sm text-text-secondary">
            Loki holds {saved.npmUser ? `${saved.npmUser}'s` : "your"} npm key
            {until ? ` until ${until}` : ""}. New packages go to npm by themselves; every release
            after the first needs no key at all.
          </p>
        ) : (
          <p className="text-sm text-text-secondary">
            {data.notOnNpm.length === 1 ? "1 package is" : `${data.notOnNpm.length} packages are`}{" "}
            not on npm yet: {data.notOnNpm.join(", ")}. npm lets only your account create a package,
            so it needs one key from you — Loki does the rest, now and for every new package until
            the key expires.
          </p>
        )}
      </div>

      {results && results.length > 0 && (
        <ul className="space-y-1 text-sm">
          {results
            .filter((r) => r.outcome !== "not-yours")
            .map((r) => (
              <li key={r.name} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-text-primary">{r.name}</span>
                <span className={r.outcome === "failed" ? "ui-error-xs" : "text-text-tertiary"}>
                  {OUTCOME_WORDS[r.outcome]}
                  {r.detail ? ` — ${r.detail}` : ""}
                </span>
              </li>
            ))}
        </ul>
      )}

      {(!saved || replacing) && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
            <li>
              <a
                href={NPM_NEW_KEY_URL}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-secondary inline-flex min-h-11 items-center gap-2"
              >
                Make the key on npm <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {NPM_KEY_SETTINGS.map((s) => (
                  <div key={s.field} className="contents">
                    <dt className="text-text-tertiary">{s.field}</dt>
                    <dd className="min-w-0 text-text-primary">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
            <li>Copy the key npm shows once, paste it here:</li>
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="npm_…"
              aria-label="npm key"
              className="ui-input ui-input-secret min-w-0 flex-1 font-mono"
            />
            <button
              type="button"
              onClick={save}
              disabled={busy || key.trim().length === 0}
              className="ui-btn-primary inline-flex min-h-11 items-center justify-center gap-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Publish to npm
            </button>
          </div>
          {error && <p className="ui-error-xs">{error}</p>}
        </div>
      )}

      {saved && !replacing && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="ui-btn-secondary min-h-11"
          >
            New key
          </button>
          <button type="button" onClick={forget} disabled={busy} className="ui-btn-ghost min-h-11">
            Forget key
          </button>
        </div>
      )}
    </section>
  );
}
