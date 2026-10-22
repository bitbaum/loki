"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson } from "@/lib/api/fetch";
import { NPM_KEY_SETTINGS, NPM_NEW_KEY_URL } from "@/config/npm-publishing";
import type { FirstPublishResult } from "@/lib/packages/npm-publish-rules";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";

type NpmKeyState = {
  key: { npmUser: string | null; expiresAt: string | null; usable: boolean } | null;
  notOnNpm: string[];
};

const OUTCOME_WORDS: Record<FirstPublishResult["outcome"], string> = {
  started: "Publishing now, on npm in a few minutes",
  "on-npm": "Already on npm",
  waiting: "Already publishing",
  "no-workflow": "Its repository cannot publish yet",
  "not-yours": "Not yours to publish",
  private: "Private, never published",
  failed: "Could not start",
};

/**
 * "Publish to npm" on /packages: one key from the owner, and Loki puts every
 * package on npm — the first version through the key, every later one through
 * GitHub with no key at all (src/lib/packages/npm-publish.ts).
 *
 * Drawn as two numbered steps on the page, not a bordered panel: make the key
 * (the exact settings npm asks for, then the link), paste it. It was a card
 * listing every unpublished package by name in one long sentence above a
 * nested list and two filled buttons.
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
    <Section title="Publish to npm">
      {saved ? (
        <p className="text-sm text-text-secondary">
          Loki holds {saved.npmUser ? `${saved.npmUser}'s` : "your"} npm key
          {until ? ` until ${until}` : ""}. New packages go to npm by themselves.
        </p>
      ) : (
        <p className="text-sm text-text-secondary">
          {data.notOnNpm.length === 1
            ? `${data.notOnNpm[0]} is not on npm yet.`
            : `${data.notOnNpm.length} packages are not on npm yet.`}{" "}
          npm needs one key from you; Loki does the rest.
        </p>
      )}

      {results && results.length > 0 && (
        <List aria-label="What happened">
          {results
            .filter((r) => r.outcome !== "not-yours")
            .map((r) => (
              <ListRow
                key={r.name}
                title={r.name}
                status={r.outcome === "failed" ? "negative" : undefined}
                secondary={OUTCOME_WORDS[r.outcome]}
              />
            ))}
        </List>
      )}

      {(!saved || replacing) && (
        <ol className="ui-steps">
          <li className="ui-step">
            <span className="ui-step-number" aria-hidden>
              1
            </span>
            <div className="ui-step-body">
              <p className="ui-step-title">Make a key on npm</p>
              <dl className="ui-step-settings">
                {NPM_KEY_SETTINGS.map((s) => (
                  <div key={s.field} className="contents">
                    <dt>{s.field}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
              <a
                href={NPM_NEW_KEY_URL}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-secondary inline-flex min-h-11 items-center gap-2 self-start"
              >
                Open npm <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </li>
          <li className="ui-step">
            <span className="ui-step-number" aria-hidden>
              2
            </span>
            <div className="ui-step-body">
              <label htmlFor="npm-key" className="ui-step-title">
                Paste the key npm shows once
              </label>
              <input
                id="npm-key"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="npm_…"
                className="ui-input ui-input-secret min-w-0 font-mono"
              />
              {error && <p className="ui-prompt-sheet-error">{error}</p>}
              <button
                type="button"
                onClick={save}
                disabled={busy || key.trim().length === 0}
                className="ui-btn-primary inline-flex min-h-11 items-center justify-center gap-2 self-start"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Publish to npm
              </button>
            </div>
          </li>
        </ol>
      )}

      {saved && !replacing && (
        <div className="flex flex-wrap gap-x-4">
          <button type="button" onClick={() => setReplacing(true)} className="ui-section-link">
            New key
          </button>
          <button type="button" onClick={forget} disabled={busy} className="ui-section-link">
            Forget key
          </button>
        </div>
      )}
    </Section>
  );
}
