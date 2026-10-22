"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookUser, Check, MessageCircle, Search, Users } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { PageLayout } from "@/components/ui/page-layout";
import { List, ListRow, ListSearch, RowInitial } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { RowActions } from "@/components/ui/row-actions";
import { DetailSheet } from "@/components/ui/detail-sheet";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { getJson, postJson } from "@/lib/api/fetch";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/timings";
import { SORT_MODE, SORT_LABELS, type SortMode } from "@/lib/constants/statuses";
import { INTERACTION_DIRECTION } from "@/lib/constants/statuses";
import { CHANNEL_NAMES, isChannelAttrKey } from "@/config/channels";
import {
  HEALTH_LABEL,
  RELATIONSHIP_HEALTH_VALUES,
  deriveRelationshipHealth,
  type RelationshipHealth,
} from "@/lib/constants/people";
import type { PersonWithAttributes } from "@/db/queries/people";
import { NewPersonButton } from "./NewPersonButton";
import { PeopleBookPanel } from "./PeopleBookPanel";

const LIMIT = 50;
const EVERYONE = "everyone";
type Show = RelationshipHealth | typeof EVERYONE;

/** What each kept-in-touch state means, said as a person would. */
const SHOW_OPTIONS: { value: Show; label: string; hint?: string }[] = [
  { value: EVERYONE, label: "Everyone" },
  ...RELATIONSHIP_HEALTH_VALUES.map((h) => ({
    value: h,
    label: HEALTH_LABEL[h],
    hint:
      h === "active"
        ? "Talked in the last two weeks"
        : h === "fading"
          ? "Two to four weeks since you talked"
          : h === "stale"
            ? "More than a month"
            : "No conversation on record",
  })),
];

const SORT_OPTIONS = (Object.values(SORT_MODE) as SortMode[]).map((s) => ({
  value: s,
  label: SORT_LABELS[s],
}));

/** "3d", "2w", "4mo" — the trailing fact, short. */
function ago(date: Date | string | null): string | undefined {
  if (!date) return undefined;
  const words = formatDistanceToNowStrict(new Date(date));
  const [n, unit] = words.split(" ");
  const short: Record<string, string> = {
    second: "now",
    seconds: "now",
    minute: "m",
    minutes: "m",
    hour: "h",
    hours: "h",
    day: "d",
    days: "d",
    month: "mo",
    months: "mo",
    year: "y",
    years: "y",
  };
  const u = short[unit ?? ""] ?? "";
  if (u === "now") return "now";
  const num = Number(n);
  if (u === "d" && num >= 7) return `${Math.floor(num / 7)}w`;
  return `${n}${u}`;
}

/**
 * /people — your book as rows, like a phone's contacts: an initial, the name,
 * what they do and where, and how long since you last talked on the right.
 * The search is the list's first row; who to show and the order are two
 * menus, not a chip row that ran off the screen; "Log talk" — a filled button
 * on every row — is in each row's own menu. Importing and merging, setup you
 * do once, is one row at the end that opens a sheet.
 *
 * Renders its own PageLayout because the page action ("Add person") has to
 * reload this list.
 */
export function PeopleList({
  initialPeople,
  initialTotal,
  initialHealth,
  openClaw = false,
}: {
  initialPeople: PersonWithAttributes[];
  initialTotal: number;
  initialHealth: RelationshipHealth | null;
  openClaw?: boolean;
}) {
  const router = useRouter();
  const [people, setPeople] = useState(initialPeople);
  const [total, setTotal] = useState(initialTotal);
  const [bookSize, setBookSize] = useState(initialHealth ? null : initialTotal);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>(SORT_MODE.RECENT);
  const [show, setShow] = useState<Show>(initialHealth ?? EVERYONE);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const skipInitialFetch = useRef(true);

  // /people?open=<id> was the drawer's deep link; the person has a page now.
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) router.replace(`/people/${open}`);
  }, [router]);

  // The filter is in the address, so the view can be shared and reloaded.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (show === EVERYONE) params.delete("health");
    else params.set("health", show);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [show]);

  const load = useCallback(
    async (q: string, s: SortMode, h: Show, offset: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q,
          sort: s,
          limit: String(LIMIT),
          offset: String(offset),
        });
        if (h !== EVERYONE) params.set("health", h);
        const data = await getJson<{ people: PersonWithAttributes[]; total: number }>(
          `/api/people?${params}`,
          { signal },
        );
        if (signal?.aborted) return;
        setFetchError(false);
        setPeople((prev) => (offset === 0 ? data.people : [...prev, ...data.people]));
        setTotal(data.total);
        if (!q && h === EVERYONE) setBookSize(data.total);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setFetchError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => load(query, sort, show, 0, ctrl.signal), SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, sort, show, load]);

  const reload = () => load(query, sort, show, 0);

  const onLogged = (id: string, at: Date) =>
    setPeople((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              lastInteraction: at,
              interactionCount: p.interactionCount + 1,
              health: deriveRelationshipHealth(at),
            }
          : p,
      ),
    );

  const filtered = !!query.trim() || show !== EVERYONE;
  const bookEmpty = bookSize === 0;

  return (
    <PageLayout
      title="People"
      maxWidth="max-w-2xl"
      action={<NewPersonButton trigger="page-action" onCreated={reload} />}
    >
      {fetchError && (
        <div className="ui-callout-negative items-center justify-between text-status-negative">
          <span>Could not load your people.</span>
          <button type="button" onClick={reload} className="ui-btn-ghost shrink-0">
            Try again
          </button>
        </div>
      )}

      {bookEmpty && !fetchError ? (
        <EmptyState
          icon={Users}
          title="Who do you work with?"
          action={
            <button type="button" onClick={() => setBookOpen(true)} className="ui-btn-secondary">
              Import your contacts
            </button>
          }
        />
      ) : (
        <div>
          <ListSearch value={query} onChange={setQuery} placeholder="Search people" />
          <SectionHeading
            title={`${total} ${total === 1 ? "person" : "people"}`}
            right={
              <div className="flex items-center gap-4">
                <ChoiceMenu label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} />
                <ChoiceMenu label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />
              </div>
            }
          />
          {people.length === 0 && !fetchError ? (
            <EmptyState
              icon={Search}
              size="sm"
              title={query ? `Nobody matches “${query.trim()}”` : "Nobody here"}
              action={
                filtered ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setShow(EVERYONE);
                    }}
                    className="ui-btn-secondary"
                  >
                    Show everyone
                  </button>
                ) : undefined
              }
            />
          ) : (
            <List aria-label="People">
              {people.map((person) => (
                <PersonRow key={person.id} person={person} onLogged={onLogged} />
              ))}
            </List>
          )}
          {people.length < total && (
            <button
              type="button"
              onClick={() => load(query, sort, show, people.length)}
              disabled={loading}
              className="ui-life-add mx-auto"
            >
              {loading ? "Loading…" : `Show ${Math.min(LIMIT, total - people.length)} more`}
            </button>
          )}
        </div>
      )}

      {!bookEmpty && (
        <List aria-label="Your book">
          <ListRow
            onClick={() => setBookOpen(true)}
            icon={BookUser}
            title="Import and tidy up"
            secondary="Bring in your contacts, merge duplicates"
            chevron
          />
        </List>
      )}

      {bookOpen && (
        <DetailSheet
          title="Fill your book"
          subtitle="It stays private to you. Nothing is sent."
          onClose={() => setBookOpen(false)}
          size="lg"
        >
          <PeopleBookPanel openClaw={openClaw} onChanged={reload} />
        </DetailSheet>
      )}
    </PageLayout>
  );
}

function PersonRow({
  person,
  onLogged,
}: {
  person: PersonWithAttributes;
  onLogged: (id: string, at: Date) => void;
}) {
  const [logged, setLogged] = useState(false);
  const profession = person.attrs["profession"] ?? person.attrs["role"] ?? person.attrs["company"];
  const location = person.attrs["location"] ?? person.attrs["home_location"];
  const channel = Object.keys(person.attrs).find(isChannelAttrKey) ?? CHANNEL_NAMES[0] ?? "other";
  const line = [profession, location].filter(Boolean).join(" · ");

  const logTalk = async () => {
    const at = new Date();
    const res = await postJson(`/api/people/${person.id}/interactions`, {
      channel,
      direction: INTERACTION_DIRECTION.OUTBOUND,
    }).catch(() => null);
    if (!res?.ok) return;
    setLogged(true);
    onLogged(person.id, at);
  };

  const lokiPrompt = [
    `Person: ${person.name}`,
    profession && `Role: ${profession}`,
    location && `Location: ${location}`,
    person.description && `Notes: ${person.description}`,
    person.lastInteraction
      ? `Last contact: ${formatDistanceToNowStrict(new Date(person.lastInteraction))} ago (${person.interactionCount} conversations)`
      : "No recorded conversations",
    "",
    "What do you know about this person? What would be a good next step with them?",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <ListRow
      href={`/people/${person.id}`}
      avatar={<RowInitial name={person.name} />}
      title={person.name}
      secondary={
        logged
          ? "Logged a conversation today"
          : line || (person.lastInteraction ? HEALTH_LABEL[person.health] : "No conversation yet")
      }
      // Only "it's been a while" earns a dot: amber, worth a nudge, never red.
      status={person.health === "stale" ? "warning" : undefined}
      trailing={ago(person.lastInteraction)}
      menu={
        <RowActions label={`More for ${person.name}`}>
          <button type="button" onClick={logTalk} className="ui-menu-item" role="menuitem">
            {logged ? <Check className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
            We talked today
          </button>
          <LokiDispatchButton
            prompt={lokiPrompt}
            title="Ask Loki about this person"
            label="Ask Loki about them"
            className="ui-menu-item"
          />
        </RowActions>
      }
    />
  );
}
