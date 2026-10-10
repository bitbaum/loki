import {
  Inbox,
  Send,
  Calendar,
  CheckCircle,
  MessageCircle,
  Moon,
  Rocket,
  Check,
  X,
  Users,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { getPendingActions, getRecentActions, type ActionRow } from "@/db/queries/actions";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { ACTION_TYPE, ACTION_STATUS, type ActionType } from "@/lib/constants/statuses";
import { ActionButtons } from "./ActionButtons";
import { ActionDecideButton } from "./ActionDecideButton";
import { CheckinGroup } from "./CheckinGroup";
import { CheckinPersonRow, type CheckinPerson } from "./CheckinPersonRow";
import { MessageReachCard } from "./MessageReachCard";
import { getPeopleSummaries, type PersonSummary } from "@/db/queries/people";
import { resolvePersonToReach } from "@/lib/people-resolve";
import { CHECKIN_TITLE_PREFIX } from "@/lib/actions/checkin-proposal";
import { compactRelativeDate } from "@/lib/dates";

const TYPE_ICONS: Record<ActionType, typeof Send> = {
  [ACTION_TYPE.SEND_MESSAGE]: MessageCircle,
  [ACTION_TYPE.SEND_EMAIL]: Send,
  [ACTION_TYPE.CREATE_EVENT]: Calendar,
  [ACTION_TYPE.CREATE_COMMITMENT]: CheckCircle,
  [ACTION_TYPE.FOLLOW_UP]: MessageCircle,
  [ACTION_TYPE.DISPATCH_PROMPT]: Rocket,
  [ACTION_TYPE.AUTOPILOT_PLAN]: Moon,
  [ACTION_TYPE.IMPORT_PERSON]: Users,
  [ACTION_TYPE.ENRICH_PERSON]: Users,
  [ACTION_TYPE.MERGE_PEOPLE]: Users,
  [ACTION_TYPE.OTHER]: Inbox,
};

type ActionGroup = {
  type: string;
  actions: CheckinPerson[];
};

function toCheckinPerson(action: ActionRow, people: Map<string, PersonSummary>): CheckinPerson {
  const person = action.entityId ? people.get(action.entityId) : undefined;
  return {
    actionId: action.id,
    name: action.title.replace(CHECKIN_TITLE_PREFIX, ""),
    personId: action.entityId,
    description: person?.description ?? null,
    lastInteraction: person?.lastInteraction ?? null,
    attrs: person?.attrs ?? {},
  };
}

function groupSimilarActions(
  actions: ActionRow[],
  people: Map<string, PersonSummary>,
): { groups: ActionGroup[]; standalone: ActionRow[] } {
  // Group "Check in with X" actions (same type + same reasoning pattern)
  const checkins: ActionRow[] = [];
  const standalone: ActionRow[] = [];

  // Group by the check-in intent (title prefix), regardless of action type — the
  // proactive producer proposes these as CREATE_COMMITMENT reminders, not
  // send_message. The prefix is the SSOT the producer writes with.
  for (const a of actions) {
    if (a.title.startsWith(CHECKIN_TITLE_PREFIX)) {
      checkins.push(a);
    } else {
      standalone.push(a);
    }
  }

  const groups: ActionGroup[] = [];
  if (checkins.length > 1) {
    groups.push({
      type: checkins[0].type,
      actions: checkins.map((a) => toCheckinPerson(a, people)),
    });
  } else {
    standalone.push(...checkins);
  }

  return { groups, standalone };
}

export async function ActionQueueCard({
  emptyState = null,
  autoOpenTop = false,
}: {
  emptyState?: React.ReactNode;
  /** Open the decision popup for the top proposal on mount. Set on /approvals,
   *  where reviewing is why you came; never on /today, where it would ambush. */
  autoOpenTop?: boolean;
} = {}) {
  const userId = await requirePageUserId();
  // Actions reference contacts ("Check in with X") and other private-zone
  // entities. Hide the whole card when the zone is locked.
  if (await isPrivateZoneLocked(userId)) {
    return null;
  }
  const [pending, recent] = await Promise.all([
    getPendingActions(userId),
    getRecentActions(userId, 5),
  ]);
  const linkedIds = pending.filter((a) => a.entityId).map((a) => a.entityId as string);
  const people = await getPeopleSummaries(userId, linkedIds);
  const resolvedByAction = new Map<string, PersonSummary>();
  for (const a of pending) {
    if (a.entityId) continue;
    if (a.type !== ACTION_TYPE.SEND_MESSAGE && a.type !== ACTION_TYPE.SEND_EMAIL) continue;
    const hint = typeof a.payload?.to === "string" ? a.payload.to : "";
    const hit = await resolvePersonToReach(userId, hint || undefined, `${hint} ${a.title}`).catch(
      () => null,
    );
    if (!hit) continue;
    resolvedByAction.set(a.id, {
      id: hit.id,
      name: hit.name,
      description: hit.description,
      attrs: hit.attrs,
      lastInteraction: hit.lastInteraction,
    });
  }

  if (pending.length === 0 && recent.length === 0) return emptyState;

  if (pending.length === 0) {
    return (
      <div id="actions" className="md:col-span-2">
        <Card>
          <CardHeader icon={Inbox} title="Action Queue" />
          <div className="space-y-1.5">
            {recent.map((action) => {
              const done =
                action.status === ACTION_STATUS.APPROVED ||
                action.status === ACTION_STATUS.EXECUTED;
              return (
                <div key={action.id} className="flex items-center gap-3 px-1 py-1 rounded">
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-status-positive shrink-0" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-text-muted shrink-0" />
                  )}
                  <span
                    className="flex-1 truncate text-sm text-text-secondary"
                    title={action.title}
                  >
                    {action.title}
                  </span>
                  {action.reviewedAt && (
                    <span className="text-xs text-text-tertiary shrink-0">
                      {compactRelativeDate(action.reviewedAt)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  }

  const { groups, standalone } = groupSimilarActions(pending, people);

  return (
    <div id="actions" className="md:col-span-2">
      <Card>
        <CardHeader
          icon={Inbox}
          title="Action Queue"
          right={
            <span className="text-xs text-status-warning font-medium">
              {pending.length} pending
            </span>
          }
        />
        <div className="space-y-3">
          {/* Grouped check-ins */}
          {groups.map((group, gi) => (
            <CheckinGroup key={`group-${gi}`} people={group.actions} />
          ))}

          {/* Standalone actions */}
          {standalone.map((action, index) => {
            const payload = action.payload;

            if (action.title.startsWith(CHECKIN_TITLE_PREFIX)) {
              return (
                <div
                  key={action.id}
                  className="border border-border-subtle rounded-md p-3 bg-surface-base"
                >
                  <CheckinPersonRow person={toCheckinPerson(action, people)} />
                </div>
              );
            }

            if (
              action.type === ACTION_TYPE.SEND_MESSAGE ||
              action.type === ACTION_TYPE.SEND_EMAIL
            ) {
              const person =
                (action.entityId ? people.get(action.entityId) : undefined) ??
                resolvedByAction.get(action.id);
              const name =
                person?.name ?? (typeof payload?.to === "string" ? payload.to : action.title);
              const channel = typeof payload?.channel === "string" ? payload.channel : null;
              const address =
                typeof payload?.address === "string"
                  ? payload.address
                  : person
                    ? (person.attrs["channel:whatsapp"] ??
                      person.attrs["channel:email"] ??
                      person.attrs["channel:phone"] ??
                      null)
                    : null;
              return (
                <div
                  key={action.id}
                  className="border border-border-subtle rounded-md p-3 bg-surface-base"
                >
                  <MessageReachCard
                    actionId={action.id}
                    name={name}
                    personId={person?.id ?? action.entityId}
                    channel={channel}
                    address={address ? String(address).replace(/^e164:/, "") : null}
                    body={typeof payload?.body === "string" ? payload.body : ""}
                    profession={person?.attrs["profession"] ?? person?.attrs["role"] ?? null}
                  />
                </div>
              );
            }

            const Icon = TYPE_ICONS[action.type] ?? Inbox;

            return (
              <div
                key={action.id}
                className="border border-border-subtle rounded-md p-3 bg-surface-base"
              >
                <div className="flex items-start gap-3">
                  <Icon className="h-4 w-4 text-text-tertiary shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm md:text-base font-medium">{action.title}</div>

                    {payload?.to != null && (
                      <div className="text-xs md:text-sm text-text-tertiary mt-0.5">
                        {"To: "}
                        {String(payload.to)}
                        {payload.channel != null ? ` via ${String(payload.channel)}` : ""}
                      </div>
                    )}

                    {/* Calendar events: show when/where so nothing is approved blind. */}
                    {(payload?.eventStart != null || payload?.eventDate != null) && (
                      <div className="text-xs md:text-sm text-text-tertiary mt-0.5">
                        {"When: "}
                        {String(payload.eventStart ?? payload.eventDate)}
                        {payload?.eventEnd != null ? ` – ${String(payload.eventEnd)}` : ""}
                        {payload?.eventLocation != null
                          ? ` · ${String(payload.eventLocation)}`
                          : ""}
                      </div>
                    )}

                    {/* The prompt body is what an agent would receive, not what
                        a triager needs to read — the Decide popup summarises it.
                        Collapsed so the card stays scannable but the exact text
                        stays one click away (nothing is approved blind). */}
                    {/* Tonight's plan IS the text; it is what is being approved,
                        so it reads in the open, not behind a disclosure. */}
                    {action.type === ACTION_TYPE.AUTOPILOT_PLAN && payload?.body != null && (
                      <p className="mt-1 text-xs md:text-sm text-text-secondary">
                        {String(payload.body)}
                      </p>
                    )}
                    {action.type !== ACTION_TYPE.AUTOPILOT_PLAN &&
                      (payload?.body != null || payload?.subject != null) && (
                        <details className="mt-2 rounded bg-surface-base border border-border-subtle">
                          <summary className="cursor-pointer px-2 py-1.5 text-xs text-text-tertiary">
                            Show the exact text that would be sent
                          </summary>
                          <div className="px-2 pb-2">
                            {payload?.subject != null && (
                              <div className="text-xs font-medium text-text-secondary mb-1">
                                {"Subject: "}
                                {String(payload.subject)}
                              </div>
                            )}
                            <pre className="text-xs text-text-secondary whitespace-pre-wrap">
                              {String(payload?.body ?? "")}
                            </pre>
                          </div>
                        </details>
                      )}

                    {action.reasoning && (
                      <div className="text-xs md:text-sm text-text-secondary mt-2 italic">
                        Loki: {action.reasoning}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {action.type === ACTION_TYPE.DISPATCH_PROMPT && (
                        <ActionDecideButton
                          actionId={action.id}
                          autoOpen={autoOpenTop && index === 0}
                        />
                      )}
                      <ActionButtons actionId={action.id} compact />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
