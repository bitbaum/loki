"use client";

import { useCallback, useMemo, useState } from "react";
import { ClipboardList, ExternalLink, UserMinus, Users, UserPlus } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { List, ListRow, RowInitial } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { RowActions } from "@/components/ui/row-actions";
import { getJson, deleteJson } from "@/lib/api/fetch";
import { deadlineLabel } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import {
  CLOSED_HUMAN_TASK_STATUSES,
  ENGAGEMENT_LABEL,
  HUMAN_TASK_STATUS_LABEL,
  HUMAN_TASK_STATUS_ORDER,
  formatFee,
  isWaitingOnOperator,
  type HumanTaskStatus,
} from "@/config/crew";
import type { CrewMember } from "@/db/queries/crew";
import type { HumanTaskRow } from "@/db/queries/human-tasks";
import { AssignmentSheet } from "./AssignmentSheet";
import { AddCrewButton } from "./AddCrewButton";
import { NewAssignmentButton, type ProjectOption } from "./NewAssignmentButton";

type Summary = { members: number; openTasks: number; waitingOnThem: number; waitingOnYou: number };

/**
 * /crew — work only a person can do, handed to the people you trust with it.
 *
 * One sentence first: is anyone waiting on you. Then the open asks, grouped
 * by where they stand in the order work travels, each a row that opens in a
 * sheet; the closed ones fold away. Then your crew, one row each, with
 * "Give them work" in the row's menu. Renders its own PageLayout because the
 * page action ("New ask") refreshes this board.
 */
export function CrewWorkspace({
  initialTasks,
  initialCrew,
  initialSummary,
  projects,
}: {
  initialTasks: HumanTaskRow[];
  initialCrew: CrewMember[];
  initialSummary: Summary;
  projects: ProjectOption[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [crew, setCrew] = useState(initialCrew);
  const [summary, setSummary] = useState(initialSummary);
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<CrewMember | null>(null);

  const refresh = useCallback(async () => {
    const [taskData, crewData] = await Promise.all([
      getJson<{ tasks: HumanTaskRow[] }>("/api/crew/tasks").catch(() => null),
      getJson<{ crew: CrewMember[]; summary: Summary }>("/api/crew").catch(() => null),
    ]);
    if (taskData) setTasks(taskData.tasks);
    if (crewData) {
      setCrew(crewData.crew);
      setSummary(crewData.summary);
    }
  }, []);

  const grouped = useMemo(() => {
    const byStatus = new Map<HumanTaskStatus, HumanTaskRow[]>();
    for (const task of tasks) {
      const list = byStatus.get(task.status) ?? [];
      list.push(task);
      byStatus.set(task.status, list);
    }
    return byStatus;
  }, [tasks]);

  const closed = CLOSED_HUMAN_TASK_STATUSES.flatMap((s) => grouped.get(s) ?? []);
  const opened = tasks.find((t) => t.id === openId) ?? null;

  const sentence = [
    summary.waitingOnYou > 0
      ? `${summary.waitingOnYou} ${summary.waitingOnYou === 1 ? "ask needs" : "asks need"} you.`
      : "Nothing needs you.",
    summary.waitingOnThem > 0
      ? `${summary.waitingOnThem} out with ${summary.members === 1 ? "your one person" : "your crew"}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const rows = (list: HumanTaskRow[]) => (
    <List aria-label="Asks">
      {list.map((task) => (
        <TaskRow key={task.id} task={task} onOpen={() => setOpenId(task.id)} />
      ))}
    </List>
  );

  const empty = tasks.length === 0 && crew.length === 0;

  return (
    <PageLayout
      title="Crew"
      maxWidth="max-w-2xl"
      action={
        <NewAssignmentButton
          crew={crew}
          projects={projects}
          onCreated={refresh}
          trigger="page-action"
        />
      }
    >
      {empty ? (
        <EmptyState
          icon={Users}
          title="Calls to make, a signature, a room to walk into?"
          action={<AddCrewButton onCreated={refresh} triggerLabel="Add someone you hand work to" />}
        />
      ) : (
        <>
          {tasks.length > 0 && <p className="ui-life-summary">{sentence}</p>}

          {HUMAN_TASK_STATUS_ORDER.filter((s) => !CLOSED_HUMAN_TASK_STATUSES.includes(s)).map(
            (status) => {
              const list = grouped.get(status) ?? [];
              if (list.length === 0) return null;
              return (
                <Section key={status} title={`${HUMAN_TASK_STATUS_LABEL[status]} · ${list.length}`}>
                  {rows(list)}
                </Section>
              );
            },
          )}

          {tasks.length === closed.length && (
            <Section title="Out with people">
              <EmptyState icon={ClipboardList} size="sm" title="Nothing out with anyone" />
            </Section>
          )}

          {closed.length > 0 && (
            <Section
              title={`Closed · ${closed.length}`}
              right={
                <button
                  type="button"
                  onClick={() => setShowClosed((v) => !v)}
                  className="ui-section-link"
                  aria-expanded={showClosed}
                >
                  {showClosed ? "Hide" : "Show"}
                </button>
              }
            >
              {showClosed && rows(closed)}
            </Section>
          )}

          <Section
            title={`Your crew · ${crew.length}`}
            right={<AddCrewButton onCreated={refresh} triggerLabel="Add" />}
          >
            {crew.length === 0 ? (
              <EmptyState>Nobody yet — add the people you actually hand work to.</EmptyState>
            ) : (
              <List aria-label="Your crew">
                {crew.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    onAssign={() => setAssignTo(member)}
                    onChanged={refresh}
                  />
                ))}
              </List>
            )}
          </Section>
        </>
      )}

      {opened && (
        <AssignmentSheet
          key={opened.id}
          task={opened}
          crew={crew.map((m) => ({ id: m.id, name: m.name }))}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}

      {assignTo && (
        <NewAssignmentButton
          key={assignTo.id}
          crew={crew}
          projects={projects}
          defaultAssigneeId={assignTo.id}
          defaultOpen
          trigger="none"
          onCreated={refresh}
          onDismiss={() => setAssignTo(null)}
        />
      )}
    </PageLayout>
  );
}

function TaskRow({ task, onOpen }: { task: HumanTaskRow; onOpen: () => void }) {
  const due = task.dueDate ? deadlineLabel(task.dueDate) : null;
  const fee = formatFee(task.feeAmount, task.feeCurrency);
  return (
    <ListRow
      onClick={onOpen}
      avatar={task.assigneeName ? <RowInitial name={task.assigneeName} /> : undefined}
      icon={task.assigneeName ? undefined : ClipboardList}
      title={task.title}
      secondary={[
        task.assigneeName ?? "Nobody yet",
        task.projectName ? projectTitle({ name: task.projectName }) : null,
        due?.label,
      ]
        .filter(Boolean)
        .join(" · ")}
      // Amber when it is your move — they delivered, or they said no.
      status={isWaitingOnOperator(task.status) ? "warning" : undefined}
      trailing={fee ?? undefined}
      chevron
    />
  );
}

function MemberRow({
  member,
  onAssign,
  onChanged,
}: {
  member: CrewMember;
  onAssign: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const rate = member.rate ? `${member.currency ? `${member.currency} ` : ""}${member.rate}` : "";
  return (
    <ListRow
      avatar={<RowInitial name={member.name} />}
      title={member.name}
      secondary={
        [
          member.role,
          member.engagement ? ENGAGEMENT_LABEL[member.engagement] : null,
          rate,
          member.skills.length > 0 ? member.skills.join(", ") : null,
        ]
          .filter(Boolean)
          .join(" · ") || "No role noted"
      }
      trailing={
        member.waitingOnThem > 0
          ? `${member.waitingOnThem} with them`
          : member.openTasks > 0
            ? `${member.openTasks} open`
            : undefined
      }
      menu={
        <RowActions label={`More for ${member.name}`}>
          <button type="button" onClick={onAssign} className="ui-menu-item" role="menuitem">
            <UserPlus className="h-3.5 w-3.5" />
            Give them work
          </button>
          {member.orangecatProfile && (
            <a
              href={member.orangecatProfile}
              target="_blank"
              rel="noreferrer"
              className="ui-menu-item"
              role="menuitem"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Their OrangeCat profile
            </a>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                // Leaves the crew only. The person, their notes and every ask
                // they ever did stay where they are.
                await deleteJson(`/api/crew/${member.id}`);
                onChanged();
              } finally {
                setBusy(false);
              }
            }}
            className="ui-menu-item ui-menu-item-danger"
            role="menuitem"
          >
            <UserMinus className="h-3.5 w-3.5" />
            Take off the crew
          </button>
        </RowActions>
      }
    />
  );
}
