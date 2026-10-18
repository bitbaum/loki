import { randomInt } from "crypto";
import { existsSync } from "fs";
import path from "path";
import { websitePreviewPrompt } from "@/config/preview-brief";
import {
  findBriefProject,
  isProjectNameTaken,
  markBriefProject,
} from "@/db/queries/brief-projects";
import { getPreviewCode } from "@/db/queries/preview-code";
import { firstFreeName } from "@/lib/brief-project-name";
import { takePagePicture } from "@/lib/feedback/page-picture";
import { withInFlight } from "@/lib/in-flight";
import { createPreview } from "@/lib/previews/create";
import { pictureFile } from "@/lib/previews/pictures";
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
  return withInFlight(`${userId}:${input.requestId}`, () => startOnce(userId, input));
}

/** How many live pages get a "before" picture the moment the preview starts. */
const BEFORE_PICTURES = 6;

/**
 * Photograph the live pages now, while they are still the "before": the tour
 * shows them next to the new version, and a page the owner changes meanwhile
 * would otherwise be compared with itself. Never blocks the start; a missing
 * browser simply leaves the tour to take its pictures when first opened.
 */
async function takeBeforePictures(dir: string, pages: readonly string[]): Promise<void> {
  for (const url of pages.slice(0, BEFORE_PICTURES)) {
    const file = pictureFile(dir, "before", url);
    if (existsSync(file)) continue;
    const shot = await takePagePicture(url).catch(() => null);
    if (!shot?.ok) continue;
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(shot.base64, "base64"));
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

  // The name is the project AND the folder: a name free in the database but
  // taken on disk (a folder kept after its project went) would otherwise be
  // served at <name>-2 while the project says <name>.
  const root = previewsRoot()!;
  const name = await firstFreeName(
    websiteProjectName(input.website, input.mode),
    async (n) => existsSync(path.join(root, n)) || (await isProjectNameTaken(n)),
  );
  // Nobody can open a preview without a code, and a stranger who just named
  // their own site has never set one: give them one, shown on the next screen.
  const code = input.code ?? ((await getPreviewCode(userId)) ? undefined : newAccessCode());
  const livePages = consulted?.ok
    ? consulted.consultation.pages.filter((p) => p.ok).map((p) => p.url)
    : [input.website];
  // The project's one line, shown on its tile: the site by its name, not its
  // URL (`https://center-com.ru/` read as an address, not as a description).
  const site = siteName(input.website);
  const about =
    input.mode === "refresh"
      ? `New version of ${site}${input.changes ? ` — ${input.changes}` : ""}`
      : `My own site, inspired by ${site} — ${input.changes}`;

  const created = await createPreview(userId, {
    name,
    address: name,
    about: about.slice(0, 2000),
    code,
    prompt: (previewUrl) =>
      websitePreviewPrompt({
        request,
        mode: input.mode === "inspired" ? "inspired" : "refresh",
        previewUrl,
      }),
    source:
      input.mode === "refresh"
        ? { website: input.website, pages: livePages, createdAt: new Date().toISOString() }
        : undefined,
  });
  if (!created.ok) return created;
  await markBriefProject(created.projectId, input.requestId, "website");
  if (input.mode === "refresh")
    void takeBeforePictures(path.join(root, created.slug), livePages).catch((e) =>
      console.error("[preview before-pictures]", e instanceof Error ? e.message : e),
    );
  return {
    ok: true,
    projectPath: `/projects/${created.projectId}/watch`,
    previewUrl: created.previewUrl,
    accessCode: created.accessCode,
  };
}

/** "https://www.center-com.ru/" → "center-com.ru". */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}
