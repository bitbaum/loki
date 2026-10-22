"use client";

// Sessions — the top bar's list of where each project's agent is, from any
// page: the ones open right now, what each is doing, and every other project
// one tap from starting its own.
//
// It was every project at once (42 rows), each with one of four coloured dots,
// one of six codes ("ready", "offline", "open", "closed", "working", "—"), the
// age of a database row, and a git-branch icon that opened the repository.
// The owner (2026-10-19): "what exactly do you mean by sessions? What will
// happen when I click on AOZ Housing? … Gray dot, green dot, black dot, red
// dot … super useless". Now: what is open, in words that say what a tap
// gives you, then the rest — and a tap always lands in that project's
// session (open → attached; not open → its Resume, TerminalSessionMiss).
//
// Polls /api/sessions/snapshot every 30s while open (DB-only, tiny); never
// while closed. The words are SSOT in lib/session-list.

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { timeAgo } from "@/lib/dates";
import { getJson } from "@/lib/api/fetch";
import type { SessionSnapshot, SessionSnapshotItem } from "@/app/api/sessions/snapshot/route";
import { useOverlayLock } from "@/hooks/use-overlay-lock";
import { NAV } from "@/config/navigation";
import { projectTitle } from "@/lib/project-display";
import { List, ListRow, ListSearch, RowInitial } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";

const POLL_INTERVAL_MS = 30_000;
/** Projects listed under "Start in another project" before "Show all". */
const OTHERS_SHOWN = 8;

/** Where a tap on a project goes: its session on the Sessions page. */
const sessionHref = (item: SessionSnapshotItem) =>
  item.session.open && item.tab
    ? `${NAV.terminal.href}?tab=${encodeURIComponent(item.tab)}`
    : `${NAV.terminal.href}?project=${encodeURIComponent(item.name)}`;

/** The tab the Sessions page is showing now, so its row reads as current. */
function currentTab(): string | null {
  if (typeof window === "undefined" || window.location.pathname !== NAV.terminal.href) return null;
  const q = new URLSearchParams(window.location.search);
  return (q.get("tab") ?? q.get("project"))?.toLowerCase() ?? null;
}

export function SessionsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Covers the app behind a full-screen backdrop, so the page must stop
  // scrolling under it — otherwise a phone swipe moves something invisible.
  useOverlayLock(open);

  // Fetch on open + on poll. Stop polling when closed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function fetchSnapshot() {
      try {
        const data = await getJson<SessionSnapshot>("/api/sessions/snapshot");
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load sessions");
      }
    }
    void fetchSnapshot();
    const timer = setInterval(fetchSnapshot, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { openNow, others } = useMemo(() => {
    const all = snapshot?.projects ?? [];
    return {
      openNow: all.filter((p) => p.session.open),
      others: all.filter((p) => !p.session.open),
    };
  }, [snapshot]);

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? others.filter((p) => `${p.name} ${projectTitle(p)}`.toLowerCase().includes(needle))
    : others;
  const shown = needle || showAll ? matching : matching.slice(0, OTHERS_SHOWN);
  const here = currentTab();

  return (
    <>
      <div className="fixed inset-0 z-40 ui-backdrop" onClick={onClose} aria-hidden />
      <aside className="ui-sessions" role="dialog" aria-labelledby="sessions-title">
        <header className="ui-sessions-head">
          <h2 id="sessions-title" className="ui-sessions-title">
            Sessions
          </h2>
          <button type="button" onClick={onClose} className="ui-topbar-btn" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="ui-sessions-body">
          {error && <p className="ui-error">{error}</p>}
          {!snapshot && !error && <p className="ui-sessions-note">Loading…</p>}

          {snapshot && (
            <Section title="Open now">
              {openNow.length === 0 ? (
                <EmptyState>Nothing is open. Pick a project below to start it.</EmptyState>
              ) : (
                <List>
                  {openNow.map((p) => {
                    const s = p.session.open ? p.session : null;
                    const current =
                      here !== null &&
                      (p.tab?.toLowerCase() === here || p.name.toLowerCase() === here);
                    return (
                      <ListRow
                        key={p.id}
                        href={sessionHref(p)}
                        onClick={onClose}
                        avatar={<RowInitial name={projectTitle(p)} />}
                        title={projectTitle(p)}
                        secondary={
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            {s?.status === "working" && (
                              <span
                                className="ui-term-live-dot ui-term-status-working"
                                aria-hidden="true"
                              />
                            )}
                            <span className="truncate">{s?.line}</span>
                          </span>
                        }
                        trailing={
                          current ? (
                            <Check
                              className="h-5 w-5 text-text-primary"
                              aria-label="You are here"
                            />
                          ) : undefined
                        }
                        chevron={!current}
                      />
                    );
                  })}
                </List>
              )}
            </Section>
          )}

          {snapshot && others.length > 0 && (
            <Section title="Start another project">
              {others.length > OTHERS_SHOWN && (
                <ListSearch value={query} onChange={setQuery} placeholder="Find a project" />
              )}
              {shown.length === 0 ? (
                <EmptyState>No project matches “{query.trim()}”.</EmptyState>
              ) : (
                <List>
                  {shown.map((p) => {
                    const last = p.session.open ? null : p.session.lastWorkedAt;
                    return (
                      <ListRow
                        key={p.id}
                        href={sessionHref(p)}
                        onClick={onClose}
                        avatar={<RowInitial name={projectTitle(p)} />}
                        title={projectTitle(p)}
                        secondary={
                          last
                            ? `Last worked ${timeAgo(new Date(last).getTime())}`
                            : "Not started yet"
                        }
                        chevron
                      />
                    );
                  })}
                </List>
              )}
              {!needle && !showAll && matching.length > OTHERS_SHOWN && (
                <button
                  type="button"
                  className="ui-btn-ghost min-h-11 self-start"
                  onClick={() => setShowAll(true)}
                >
                  Show all {matching.length}
                </button>
              )}
            </Section>
          )}
        </div>
      </aside>
    </>
  );
}
