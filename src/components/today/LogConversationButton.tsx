"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, X, Check, Loader2, Search } from "lucide-react";
import { CHANNEL_NAMES } from "@/config/channels";
import { getJson, postJson, throwApiError } from "@/lib/api/fetch";
import { toLocalDateStr } from "@/lib/dates";
import { INTERACTION_DIRECTION, SORT_MODE } from "@/lib/constants/statuses";

type PersonResult = { id: string; name: string };

export function LogConversationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locked, setLocked] = useState(false);
  const [selected, setSelected] = useState<PersonResult | null>(null);
  const [channel, setChannel] = useState(CHANNEL_NAMES[0] ?? "whatsapp");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setQuery("");
    setResults([]);
    setSelected(null);
    setNote("");
    setDone(false);
    setSaveError(null);
    setOpen(false);
  };

  // Debounced search with AbortController so a slow earlier response
  // can't clobber a faster later one when the user types continuously.
  // Clearing results on an emptied query happens in the input's onChange
  // (an event, not this effect), so the effect only ever sets state from
  // its async callbacks.
  useEffect(() => {
    if (!query.trim()) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await getJson<{ people?: PersonResult[] }>(
          `/api/people?q=${encodeURIComponent(query)}&limit=6&sort=${SORT_MODE.RECENT}`,
          { signal: ctrl.signal },
        );
        if (!ctrl.signal.aborted) {
          setResults(data.people ?? []);
          setLocked(false);
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        // The private zone is locked: People answers 403, and "No results"
        // was a wrong answer with no way forward (2026-11-12).
        if (err instanceof Error && err.message === "HTTP 403") {
          setResults([]);
          setLocked(true);
          return;
        }
        throw err;
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await postJson(`/api/people/${selected.id}/interactions`, {
        channel,
        direction: INTERACTION_DIRECTION.OUTBOUND,
        summary: note || undefined,
        occurredAt: toLocalDateStr(new Date()),
      });
      if (!res.ok) await throwApiError(res, "Failed to save");
      setDone(true);
      setTimeout(() => {
        reset();
        router.refresh();
      }, 1200);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ui-btn-pill-muted">
        <MessageCircle className="h-3.5 w-3.5" />
        Log a conversation
      </button>
    );
  }

  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">Log a conversation</span>
        <button
          onClick={reset}
          className="text-text-muted hover:text-text-secondary transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {done ? (
        <div className="flex items-center gap-1.5 text-xs text-status-positive py-1">
          <Check className="h-3.5 w-3.5" />
          Logged with {selected?.name}
        </div>
      ) : selected ? (
        /* Channel + note step */
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary font-medium">{selected.name}</span>
            <button
              onClick={() => {
                setSelected(null);
                setQuery("");
              }}
              className="ui-link-muted"
            >
              change
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="ui-input-tight"
            >
              {CHANNEL_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") reset();
              }}
              placeholder="Brief note (optional)"
              autoFocus
              className="flex-1 ui-input-tight"
            />
          </div>
          {saveError && <p className="ui-error-xs">{saveError}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="ui-btn-save">
              {saving ? <Loader2 className="ui-spinner-xs" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button onClick={reset} className="ui-btn-text-cancel">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Person search step */
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) setResults([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") reset();
              }}
              placeholder="Search person…"
              className="ui-input-inline border-border-subtle w-full pl-6 pr-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted"
            />
            {searching && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 ui-spinner-xs text-text-muted" />
            )}
          </div>
          {results.length > 0 && (
            <div className="space-y-0.5">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected(p);
                    setQuery("");
                    setResults([]);
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised rounded transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {query.trim() && !searching && locked && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-secondary">
              Your contacts are locked.
              <Link
                href="/unlock?next=/today"
                className="inline-flex min-h-11 items-center font-medium text-text-primary underline underline-offset-2"
              >
                Unlock
              </Link>
            </div>
          )}
          {query.trim() && !searching && !locked && results.length === 0 && (
            <div className="text-xs text-text-secondary px-2 py-1">No results</div>
          )}
        </div>
      )}
    </div>
  );
}
