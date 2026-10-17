"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getJson, postJson, throwApiError } from "@/lib/api/fetch";
import { BOOK_ATTR_LABEL, IMPORT_SOURCE_LABEL } from "@/config/book";
import { ASSISTANT_STACK, CONTACT_IMPORT_GUIDE } from "@/config/assistant-stack";
import { pickCanonicalPerson, type DedupePerson } from "@/lib/people-dedupe";

type Proposal = {
  id: string;
  type: string;
  title: string;
  reasoning: string | null;
  payload: Record<string, unknown> | null;
};

type Cluster = {
  key: string;
  reason: "email" | "phone" | "name";
  members: DedupePerson[];
};

export function PeopleBookPanel({
  onChanged,
  /** Start expanded. True when the book is empty — the one moment when
   *  filling it IS the page rather than setup you already did. */
  defaultOpen = false,
  /**
   * Offer the OpenClaw sync. Only the site operator: the sync reads the
   * OpenClaw book from the SERVER, which is the operator's own. Shown to every
   * account until 2026-10-17, together with a paragraph explaining OpenClaw
   * and Hermes to people who have neither.
   */
  openClaw = false,
}: {
  onChanged?: () => void;
  defaultOpen?: boolean;
  openClaw?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Promise-callback form (not async/await): the setStates live inside a
  // .then callback, so calling refresh() from the mount effect never sets
  // state synchronously within the effect body. Same microtask timing.
  const refresh = useCallback(
    () =>
      Promise.all([
        getJson<{ proposals: Proposal[] }>("/api/people/proposals"),
        getJson<{ clusters: Cluster[] }>("/api/people/duplicates"),
      ]).then(([p, d]) => {
        setProposals(p.proposals);
        setClusters(d.clusters);
      }),
    [],
  );

  useEffect(() => {
    void refresh().catch(() => setError("Could not load book proposals"));
  }, [refresh]);

  async function decide(id: string, decision: "accept" | "discard") {
    setBusy(id);
    setError(null);
    try {
      const res = await postJson(`/api/people/proposals/${id}`, { decision });
      if (!res.ok) await throwApiError(res, "Failed");
      await refresh();
      if (decision === "accept") onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function merge(keepId: string, dropId: string) {
    setBusy(`merge:${dropId}`);
    setError(null);
    try {
      const res = await postJson("/api/people/merge", { keepId, dropId });
      if (!res.ok) await throwApiError(res, "Merge failed");
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    setBusy("import");
    setError(null);
    setImportNote(null);
    try {
      const text = await file.text();
      let offset = 0;
      let created = 0;
      let enriched = 0;
      let skipped = 0;
      let parsed = 0;
      let source = "";
      let done = false;
      while (!done) {
        const res = await postJson("/api/people/import", { text, filename: file.name, offset });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          created?: number;
          enriched?: number;
          skipped?: number;
          parsed?: number;
          source?: string;
          nextOffset?: number;
          done?: boolean;
        };
        if (!res.ok) throw new Error(data.error ?? "Import failed");
        created += data.created ?? 0;
        enriched += data.enriched ?? 0;
        skipped += data.skipped ?? 0;
        parsed = data.parsed ?? parsed;
        source = data.source ?? source;
        offset = data.nextOffset ?? offset;
        done = Boolean(data.done);
        setImportNote(
          `Writing ${IMPORT_SOURCE_LABEL[source as keyof typeof IMPORT_SOURCE_LABEL] ?? source}: ${offset}/${parsed}…`,
        );
      }
      setImportNote(
        `${parsed} from ${IMPORT_SOURCE_LABEL[source as keyof typeof IMPORT_SOURCE_LABEL] ?? source}. ${created} new, ${enriched} enriched, ${skipped} already current.`,
      );
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function syncOpenClaw() {
    setBusy("openclaw");
    setError(null);
    setImportNote(null);
    try {
      const res = await postJson("/api/people/sync/openclaw", {});
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        created?: number;
        enriched?: number;
        skipped?: number;
        parsed?: number;
        knowledge?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "OpenClaw sync failed");
      setImportNote(
        `OpenClaw: ${data.parsed} contacts${data.knowledge ? ` (${data.knowledge} from knowledge)` : ""}. ${data.created ?? 0} new, ${data.enriched ?? 0} enriched, ${data.skipped ?? 0} already current.`,
      );
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "OpenClaw sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function mergeObvious() {
    setBusy("twins");
    setError(null);
    try {
      const res = await postJson("/api/people/merge-obvious", {});
      const data = (await res.json()) as {
        ok?: boolean;
        merged?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Merge failed");
      setImportNote(
        `Merged ${data.merged ?? 0} obvious twins (same email or phone). Skipped ${data.skipped ?? 0} name-only guesses.`,
      );
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy("scan");
    setError(null);
    try {
      const res = await postJson("/api/people/proposals", {});
      const data = (await res.json()) as { ok?: boolean; proposed?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      setImportNote(`${data.proposed ?? 0} enrichment proposals from data already in the book.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(null);
    }
  }

  const pending = proposals.length;

  return (
    <section className="ui-card-shell overflow-hidden">
      {/* A disclosure, not a banner. Everything below is reference and one-off
          setup; keeping it open cost 482px above the contact list on every
          visit, whether or not the book already had people in it. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ui-book-panel-toggle"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">Fill the book</span>
          <span className="block text-xs text-text-tertiary">
            {openClaw
              ? `Import contacts, sync ${ASSISTANT_STACK.openclaw.name}, merge duplicates`
              : "Import your contacts, merge duplicates"}
            {pending > 0 ? ` · ${pending} to review` : ""}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {!open ? null : (
        <div className="space-y-4 border-t border-border-subtle p-4">
          {openClaw && (
            <p className="text-sm text-text-secondary">
              {ASSISTANT_STACK.loki.name} is the book and the assistant that talks to it.{" "}
              {ASSISTANT_STACK.openclaw.name} is the WhatsApp/Telegram workspace that filled most of
              these names. {ASSISTANT_STACK.hermes.name} is a task CLI — not a contact book. Nothing
              is sent.
            </p>
          )}
          <ul className="space-y-1 text-sm text-text-tertiary">
            {CONTACT_IMPORT_GUIDE.filter((g) => openClaw || g.id !== "openclaw").map((g) => (
              <li key={g.id}>
                <span className="text-text-secondary">{g.title}.</span> {g.how}
              </li>
            ))}
          </ul>
          {/* Two of the three recipes above are desktop export flows. Say so on a
          phone rather than leaving the reader to work out why the steps do not
          exist on their device. */}
          <p className="text-xs text-text-muted sm:hidden">
            The Google and Apple exports need a computer — do those there, then pick the file up
            here.
            {openClaw ? ` Syncing ${ASSISTANT_STACK.openclaw.name} works from this phone.` : ""}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              ref={fileRef}
              type="file"
              accept=".vcf,.vcard,.csv,.json,text/vcard,text/csv,application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="ui-btn-chip"
            >
              {busy === "import" ? "Reading…" : "Import address book"}
            </button>
            {openClaw && (
              <button
                type="button"
                onClick={() => void syncOpenClaw()}
                disabled={busy !== null}
                className="ui-btn-chip"
              >
                {busy === "openclaw" ? "Syncing…" : "Sync OpenClaw book"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void scan()}
              disabled={busy !== null}
              className="ui-btn-chip"
            >
              {busy === "scan" ? "Scanning…" : "Propose enrichments"}
            </button>
            {clusters.some((c) => c.reason !== "name" && c.members.length === 2) && (
              <button
                type="button"
                onClick={() => void mergeObvious()}
                disabled={busy !== null}
                className="ui-btn-chip"
              >
                {busy === "twins" ? "Merging…" : "Merge obvious twins"}
              </button>
            )}
          </div>
          {importNote && <p className="text-sm text-text-secondary">{importNote}</p>}
          {error && <p className="ui-error-xs">{error}</p>}

          {proposals.length > 0 && (
            <div className="space-y-2">
              <h2 className="ui-kicker">{proposals.length} to review</h2>
              {proposals.map((p) => {
                const field =
                  typeof p.payload?.key === "string"
                    ? (BOOK_ATTR_LABEL[p.payload.key] ?? p.payload.key)
                    : null;
                const value = typeof p.payload?.value === "string" ? p.payload.value : null;
                return (
                  <div
                    key={p.id}
                    className="ui-card-shell flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {p.title}
                      </div>
                      {value && (
                        <div className="truncate text-sm text-text-secondary">
                          {field}: {value}
                        </div>
                      )}
                      {p.reasoning && <p className="text-xs text-text-tertiary">{p.reasoning}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void decide(p.id, "accept")}
                        className="ui-btn-chip"
                      >
                        {busy === p.id ? "…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void decide(p.id, "discard")}
                        className="ui-link-subtle"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {clusters.length > 0 && (
            <div className="space-y-2">
              <h2 className="ui-kicker">{clusters.length} possible duplicates</h2>
              {clusters.map((c) => (
                <div key={`${c.reason}:${c.key}`} className="ui-card-shell space-y-2 p-3">
                  <p className="text-xs text-text-tertiary">
                    Same {c.reason}
                    {c.reason !== "name" ? ` (${c.key})` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.members.map((m, i) => (
                      <span key={m.id} className="text-sm text-text-primary">
                        {i > 0 && <span className="text-text-tertiary"> · </span>}
                        {m.name}
                      </span>
                    ))}
                  </div>
                  {c.members.length >= 2 &&
                    (() => {
                      const keep = pickCanonicalPerson(c.members);
                      const drop = c.members.find((m) => m.id !== keep.id)!;
                      return (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void merge(keep.id, drop.id)}
                          className="ui-btn-chip"
                        >
                          Keep {keep.name}, merge {drop.name}
                        </button>
                      );
                    })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
