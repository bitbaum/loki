"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { ApproveGroupButton } from "./ApproveGroupButton";
import { CheckinPersonRow, type CheckinPerson } from "./CheckinPersonRow";
import { ACTION_COPY } from "@/config/action-copy";
import { NAV } from "@/config/navigation";
import { useState } from "react";

export function CheckinGroup({ people }: { people: CheckinPerson[] }) {
  const [allReminded, setAllReminded] = useState(false);

  return (
    <div className="ui-approvals-item">
      <div className="flex items-start gap-3">
        <Users className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-medium md:text-base">
                {ACTION_COPY.checkin.groupTitle(people.length)}
              </div>
              <p className="mt-1 text-xs text-text-secondary">{ACTION_COPY.checkin.groupWhy}</p>
            </div>
            {!allReminded && (
              <ApproveGroupButton
                ids={people.map((p) => p.actionId)}
                onDone={() => setAllReminded(true)}
              />
            )}
          </div>

          {allReminded ? (
            <ul className="mt-3 space-y-1.5">
              {people.map((p) => (
                <li key={p.actionId}>
                  <Link
                    href={
                      p.personId
                        ? `${NAV.people.href}?open=${encodeURIComponent(p.personId)}`
                        : NAV.people.href
                    }
                    className="ui-link-subtle ui-tap text-sm"
                  >
                    {ACTION_COPY.checkin.open} {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 space-y-1.5">
              {people.map((person) => (
                <CheckinPersonRow key={person.actionId} person={person} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
