import type { BuildStatus } from "@/lib/project-build-status";
import { MemberGuide } from "./MemberGuide";
import { ProjectBuildStatus } from "./ProjectBuildStatus";

/**
 * The whole project page for a client or viewer: the box to ask in, then
 * whether something is being built. They came to say what they want and see
 * it happen. Story, Plan and Activity are the builder's working papers —
 * health scores, agent context, runs and commits — and on a phone they hid
 * the one box she came for behind a "Section" menu (2026-10-19). Flags stay
 * on the builder's page: "Security risk" is the builder's to fix, and a client
 * reading it can do nothing with it.
 */
export function MemberProjectView({
  projectId,
  role,
  projectName,
  ownerName,
  liveUrl,
  ownerPass,
  memberPass,
  joined,
  ready,
  status,
  workspaceKey,
}: {
  projectId: string;
  role: "client" | "viewer";
  projectName: string;
  ownerName: string | null;
  liveUrl: string | null;
  ownerPass: string | null;
  memberPass: string | null;
  joined: boolean;
  ready: { id: string; suggestion: string }[];
  status: BuildStatus;
  workspaceKey: string;
}) {
  return (
    <div className="space-y-5">
      <MemberGuide
        projectId={projectId}
        role={role}
        projectName={projectName}
        ownerName={ownerName}
        liveUrl={liveUrl}
        ownerPass={ownerPass}
        memberPass={memberPass}
        joined={joined}
        ready={ready}
      />
      <ProjectBuildStatus
        status={status}
        liveUrl={liveUrl}
        projectId={projectId}
        workspaceKey={workspaceKey}
        readonly
        setupNeeded={false}
        hasNextStep={false}
      />
    </div>
  );
}
