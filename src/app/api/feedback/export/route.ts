import { NextRequest } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getUserProjects } from "@/db/queries/user-projects";
import { listProjectFeedback } from "@/db/queries/site-feedback";
import { feedbackFileName, formatFeedbackForAgent } from "@/lib/feedback/agent-export";

/**
 * GET /api/feedback/export?project=<name> — the project's feedback reports as
 * one text file for the session box to attach (lib/feedback/agent-export).
 * Owner-scoped: only your own project, only your own reports. Nothing is sent
 * anywhere from here; the person sees the file on the box and decides.
 */
export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const name = req.nextUrl.searchParams.get("project")?.trim().slice(0, 120);
  if (!name) return jsonError("Which project? Pass ?project=<name>.", 400);

  const projects = await getUserProjects(userId);
  const project = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!project) return jsonError(`No project called “${name}”.`, 404);
  if (!project.entityProjectId) {
    return jsonOk({
      file: { kind: "text", ...exportOf(project.name, []) },
      count: 0,
    });
  }
  const rows = await listProjectFeedback(userId, project.entityProjectId);
  const exported = formatFeedbackForAgent(project.name, rows);
  return jsonOk({
    file: { kind: "text", name: feedbackFileName(project.name), content: exported.content },
    count: exported.total,
    included: exported.included,
  });
}

function exportOf(project: string, rows: []) {
  return {
    name: feedbackFileName(project),
    content: formatFeedbackForAgent(project, rows).content,
  };
}
