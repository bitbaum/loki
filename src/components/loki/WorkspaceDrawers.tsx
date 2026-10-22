"use client";

import type { ComponentProps, ReactNode } from "react";
import { Drawer } from "@/components/ui/modal";
import { ProjectFilter } from "./ProjectFilter";

/**
 * The workspace's two slide-overs: the chats (a phone's rail) and the project
 * scope. They back the compact toolbar on phones and keep project inventory
 * out of the primary chat on every breakpoint. Lifted out of LokiWorkspace,
 * which is at its line cap.
 */
export function WorkspaceDrawers({
  historyOpen,
  onCloseHistory,
  history,
  filterOpen,
  onCloseFilter,
  filter,
}: {
  historyOpen: boolean;
  onCloseHistory: () => void;
  history: ReactNode;
  filterOpen: boolean;
  onCloseFilter: () => void;
  filter: ComponentProps<typeof ProjectFilter>;
}) {
  return (
    <>
      {historyOpen && (
        <Drawer onClose={onCloseHistory} size="md">
          <div className="flex min-h-0 flex-1 flex-col p-3">{history}</div>
        </Drawer>
      )}
      {filterOpen && (
        <Drawer onClose={onCloseFilter} size="md">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <ProjectFilter {...filter} />
          </div>
        </Drawer>
      )}
    </>
  );
}
