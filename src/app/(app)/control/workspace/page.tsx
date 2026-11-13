import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { decideWorkspaceAccess } from "@/lib/workspace-access";
import { WorkspaceTerminalClient } from "@/components/control/WorkspaceTerminalClient";
import { WorkspaceUnavailable } from "@/components/control/WorkspaceUnavailable";

export default async function WorkspaceTerminalPage() {
  const userId = await getSessionUserId();
  if (!userId) {
    return <WorkspaceUnavailable error="Sign in to open a workspace terminal." />;
  }

  const access = await decideWorkspaceAccess(userId);
  // Nothing links here, and with server workspaces switched off Terminal is
  // the one place to watch agents — so go there rather than explain why not.
  if (!access.ok && access.code === "server-workspaces-disabled") redirect("/terminal");
  if (!access.ok) {
    return <WorkspaceUnavailable error={access.error} code={access.code} />;
  }

  return <WorkspaceTerminalClient />;
}
