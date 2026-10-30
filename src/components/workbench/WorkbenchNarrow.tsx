import { Globe } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { PageLayout } from "@/components/ui/page-layout";
import { WORKBENCH_PANE_IDS, WORKBENCH_PANES } from "@/config/workbench";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import type { WorkbenchSite } from "./workbench-types";

/**
 * The workbench on a phone: the same three things as rows, each opening the
 * phone's own shape of it (the surface each pane is a column of, from the
 * pane registry). Two columns on a 390px screen would be two unreadable
 * strips; no-screen mode and the session's phone chrome already exist for
 * exactly this width, so this page sends there instead of squeezing (one
 * shape per kind, fleet AGENTS.md).
 */
export function WorkbenchNarrow({
  projectId,
  projectName,
  workspaceKey,
  site,
}: {
  projectId: string;
  projectName: string;
  workspaceKey: string;
  site: WorkbenchSite | null;
}) {
  return (
    <PageLayout
      title="Workbench"
      back={{ href: `/projects/${projectId}`, label: projectName }}
      maxWidth="max-w-2xl"
    >
      <List aria-label="Workbench">
        {site && (
          <ListRow
            href={site.href}
            external
            icon={Globe}
            title={site.kind === "preview" ? "Open the preview" : "Open the site"}
            secondary="Point at anything there and say what to change"
            chevron
          />
        )}
        {WORKBENCH_PANE_IDS.map((id) => {
          const meta = WORKBENCH_PANES[id];
          return (
            <ListRow
              key={id}
              href={fleetSurfaceHref(meta.surface, workspaceKey)}
              icon={meta.icon}
              title={meta.label}
              secondary={meta.description}
              chevron
            />
          );
        })}
      </List>
    </PageLayout>
  );
}
