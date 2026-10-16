import { randomInt } from "crypto";
import { websitePreviewPrompt } from "@/config/preview-brief";
import {
  findBriefProject,
  isProjectNameTaken,
  markBriefProject,
} from "@/db/queries/brief-projects";
import { getPreviewCode } from "@/db/queries/preview-code";
import { firstFreeName } from "@/lib/brief-project-name";
import { createPreview } from "@/lib/previews/create";
import { previewsRoot } from "@/lib/previews/root";
import { tourForBrief } from "@/lib/site-consult/advice";
import { consultSite } from "@/lib/site-consult/consult-site";
import {
  websitePreviewRequest,
  websiteProjectName,
  type WebsiteBuildInput,
} from "@/lib/website-brief";

/**
 * /change → a PREVIEW, not a repository.
 *
 * "Improve this site" used to create a GitHub repository, provision it and run
 * a kickoff that told the agent to "treat the repository as possibly empty" —
 * for a site that already exists. Two clicks made two repositories
 * (center-com, center-com-2, 2026-10-16), and the owner still had nothing to
 * show the client but a run log. A preview is what the studio already does
 * for prospects (docs/architecture/prospect-previews.md): a folder with its
 * own local history, served at <name>.orangecat.ch behind the access code,
 * with the feedback widget on it — so the client opens one link and sees the
 * new version, plus improvements.html, the tour of what changed. The
 * repository comes when they say yes (graduation), never before.
 *
 * Returns null when this server has no preview folder (a dev laptop): the
 * caller then takes the repository path, so nobody hits a wall.
 */
export type WebsitePreviewStart =
  | { ok: true; projectPath: string; previewUrl: string | null; accessCode: string | null }
  | { ok: false; status: number; error: string };

const inFlight = new Map<string, Promise<WebsitePreviewStart | null>>();

/** A code a person can say on the phone: two short words' worth of letters. */
function newAccessCode(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  return Array.from({ length: 6 }, () => letters[randomInt(letters.length)]).join("");
}

export async function startWebsitePreview(
  userId: string,
  input: WebsiteBuildInput,
): Promise<WebsitePreviewStart | null> {
  if (!previewsRoot()) return null;
  const key = `${userId}:${input.requestId}`;
  const prior = inFlight.get(key);
  if (prior) await prior.catch(() => undefined);
  const run = startOnce(userId, input);
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(key) === run) inFlight.delete(key);
  }
}

async function startOnce(
  userId: string,
  input: WebsiteBuildInput,
): Promise<WebsitePreviewStart | null> {
  // A repeat of the same request (double tap, retry after a network blip)
  // opens the preview it already made — never a second one.
  const existing = await findBriefProject(userId, input.requestId);
  if (existing)
    return {
      ok: true,
      projectPath: `/projects/${existing.id}/watch`,
      previewUrl: null,
      accessCode: null,
    };

  // The tour the consultation already took (cached), so the agent starts with
  // the site's real page list instead of guessing from the homepage.
  const consulted =
    input.mode === "refresh" ? await consultSite(input.website).catch(() => null) : null;
  const tour = consulted?.ok ? tourForBrief(consulted.consultation) : [];
  const request = websitePreviewRequest(input, tour);

  const name = await firstFreeName(websiteProjectName(input.website, input.mode), (n) =>
    isProjectNameTaken(n),
  );
  // Nobody can open a preview without a code, and a stranger who just named
  // their own site has never set one: give them one, shown on the next screen.
  const code = (await getPreviewCode(userId)) ? undefined : newAccessCode();
  const about =
    input.mode === "refresh"
      ? `New version of ${input.website}${input.changes ? ` — ${input.changes}` : ""}`
      : `My own site, inspired by ${input.website} — ${input.changes}`;

  const created = await createPreview(userId, {
    name,
    about: about.slice(0, 2000),
    code,
    prompt: (previewUrl) =>
      websitePreviewPrompt({
        request,
        mode: input.mode === "inspired" ? "inspired" : "refresh",
        previewUrl,
      }),
  });
  if (!created.ok) return created;
  await markBriefProject(created.projectId, input.requestId, "website");
  return {
    ok: true,
    projectPath: `/projects/${created.projectId}/watch`,
    previewUrl: created.previewUrl,
    accessCode: created.accessCode,
  };
}
