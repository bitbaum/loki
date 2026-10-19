/**
 * "Build a preview for <name>": the one entry point for prospects.
 *
 * Makes the folder (with its own local git history), a Loki project that
 * points at it and has no GitHub repository, a widget key for it, and the
 * owner link — then hands the build brief to an agent on the box. The folder
 * becomes a real repository only when the person says yes (graduation, see
 * docs/architecture/prospect-previews.md).
 */
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { previewEntryPath } from "@/config/previews";
import { previewBuildPrompt } from "@/config/preview-brief";
import { getPreviewCode, setPreviewCode, setProjectPreviewCode } from "@/db/queries/preview-code";
import { createUserProject } from "@/db/queries/user-projects";
import { upsertWidgetToken } from "@/db/queries/widget-tokens";
import { isUniqueViolation } from "@/lib/api/route-helpers";
import { appUrl } from "@/lib/email";
import { createOwnerPass } from "@/lib/feedback/owner-pass";
import { injectPrompt } from "@/lib/inject-core";
import { previewCodeFor } from "@/lib/previews/access";
import { isPreviewAddress } from "@/lib/previews/address";
import { attachPreviewHost, waitForHost } from "@/lib/previews/host";
import { LOKI_DIR, type PreviewSource } from "@/lib/previews/improvements";
import { writePreviewSource } from "@/lib/previews/folder";
import { previewsRoot, slugifyPreviewName } from "@/lib/previews/root";
import { unpackArchive } from "@/lib/previews/unpack";
import { ownerSiteUrl } from "@/lib/feedback/owner-pass";
import { isProjectNameTaken } from "@/db/queries/brief-projects";

const run = promisify(execFile);

export type CreatePreviewResult =
  | {
      ok: true;
      slug: string;
      projectId: string;
      /** The code to tell them: the operator's own, or null when the server's applies. */
      accessCode: string | null;
      /** The address to send, opened with the access code. */
      previewUrl: string;
      /** The same address carrying the owner pass: their notes start a build. */
      ownerUrl: string;
      /** Null when the build started; otherwise what to do next. */
      buildNote: string | null;
      /** Null when the preview has its own address and it answers; otherwise what is wrong. */
      addressNote: string | null;
      /** Null when a code opens it; otherwise that it stays closed until one is set. */
      codeNote: string | null;
    }
  | { ok: false; status: number; error: string };

const MAX_SLUG_TRIES = 50;

/** The first free folder for this name: `name`, `name-2`, `name-3`, … */
function freeSlug(root: string, name: string): string | null {
  const base = slugifyPreviewName(name);
  for (let i = 1; i <= MAX_SLUG_TRIES; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!existsSync(path.join(root, slug))) return slug;
  }
  return null;
}

const PLACEHOLDER = (name: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name.replace(/[<&>"]/g, "")}</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:0 16px">
<p>This preview is being built. Check back in a few minutes.</p>
</body></html>
`;

/** Git in the preview folder, as Loki. */
const gitIn =
  (dir: string) =>
  (...args: string[]) =>
    run("git", ["-c", "user.name=Loki", "-c", "user.email=loki@orangecat.ch", ...args], {
      cwd: dir,
    });

async function initFolder(dir: string, name: string, source?: PreviewSource): Promise<void> {
  await mkdir(dir, { recursive: false });
  await writeFile(path.join(dir, "index.html"), PLACEHOLDER(name));
  // Loki's own files (what the preview was made from, the tour's pictures)
  // stay out of the site's history: they are not the site, and they must not
  // travel when the folder becomes a repository.
  await writeFile(path.join(dir, ".gitignore"), `${LOKI_DIR}/\n`);
  if (source) await writePreviewSource(dir, source);
  const git = gitIn(dir);
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "-m", `Start the preview for ${name}`);
}

export async function createPreview(
  userId: string,
  input: {
    name: string;
    about?: string;
    address?: string;
    /** Saved as the operator's code for every preview, now and later. */
    code?: string;
    /** A code for THIS preview only, never saved as the operator's: the one a
     *  new account's approved request is given (config/build-requests), since
     *  the operator's code opens every preview they have. Wins over `code`. */
    ownCode?: string;
    archive?: Uint8Array;
    /** Refuse to create one nobody could open (the chat and the dialog); the
     *  box-side create leaves the code to be set in the app. */
    requireCode?: boolean;
    /** The build brief, when the preview starts from something more than a
     *  name (a live website: lib/previews/from-website). Default: the
     *  research-from-public-sources brief. */
    prompt?: (previewUrl: string) => string;
    /** The live site this preview is made from, kept in the folder so the
     *  before-and-after tour knows what "before" is. */
    source?: PreviewSource;
  },
): Promise<CreatePreviewResult> {
  // A preview is a folder on the fleet's own server, built by the cloud
  // builder and published as <slug>.orangecat.ch with the fleet's deploy key.
  // That is fleet infrastructure: until 2026-10-17 any signed-in account
  // could put an uploaded site on an orangecat.ch address this way.
  if (!(await isFleetInfrastructureAllowed(userId))) {
    return {
      ok: false,
      status: 403,
      error:
        "Previews are built on Loki's own computers, which this account does not have. Create a project instead, and build it with the desktop app.",
    };
  }
  const name = input.name.trim();
  const root = previewsRoot();
  if (!root) {
    return {
      ok: false,
      status: 503,
      error:
        "Previews are not set up on this server yet. Set LOKI_PREVIEWS_ROOT (or LOKI_BOX_DEV_ROOT) in the app's environment.",
    };
  }
  await mkdir(root, { recursive: true });
  // Everything that can refuse, before anything that leaves a trace: a code
  // saved, a folder made or a host attached for a request that then fails
  // would change what the operator's other previews do (the code opens all of
  // them) or leave a vhost pointing at nothing.
  const own = input.ownCode?.trim();
  const given = own ? undefined : input.code?.trim();
  const accessCode = own || given || (await getPreviewCode(userId));
  const hasCode = Boolean(previewCodeFor(accessCode));
  if (!hasCode && input.requireCode) {
    return {
      ok: false,
      status: 400,
      error: "Choose an access code (any word) so only the people you tell can open it.",
    };
  }
  const codeNote = hasCode
    ? null
    : "No access code yet: it stays closed until you set one (say 'set the preview code to ...' in Loki).";

  // The address is the folder and the subdomain: <address>.orangecat.ch. Asked
  // for, it is taken as written or refused; not asked for, it follows the name.
  const address = input.address?.trim().toLowerCase();
  if (address && !isPreviewAddress(address)) {
    return {
      ok: false,
      status: 400,
      error: "An address is lowercase letters, digits and dashes, and not a reserved name.",
    };
  }
  if (address && existsSync(path.join(root, address))) {
    return { ok: false, status: 409, error: `${address} is already taken. Pick another address.` };
  }
  if (await isProjectNameTaken(name)) {
    return { ok: false, status: 409, error: `You already have a project called "${name}".` };
  }
  const slug = address || freeSlug(root, name);
  if (!slug) return { ok: false, status: 409, error: "Too many previews with that name already." };
  const dir = path.join(root, slug);

  if (given) await setPreviewCode(userId, given);
  await initFolder(dir, name, input.source);

  // A site that already exists replaces the placeholder and is committed as it
  // arrived; nothing is built, because there is nothing to build yet.
  if (input.archive) {
    const unpacked = await unpackArchive(input.archive, dir);
    if (!unpacked.ok) {
      await rm(dir, { recursive: true, force: true });
      return { ok: false, status: 400, error: unpacked.error };
    }
    const git = gitIn(dir);
    await git("add", "-A");
    await git("commit", "-q", "-m", `Bring in the site for ${name}`);
  }

  // Its own address when this server can set one; the /p/ path when it cannot.
  const host = await attachPreviewHost(slug);
  const previewUrl = host.ok ? host.url : new URL(previewEntryPath(slug), appUrl()).toString();
  // Attached is not the same as reachable: wait until the address answers over
  // HTTPS, and say so plainly when it does not (never report success on hope).
  const addressNote = !host.ok
    ? host.reason
    : (await waitForHost(host.url))
      ? null
      : "The address is set up but not answering over HTTPS yet. Its certificate is still being issued; try again in a minute.";
  let project;
  try {
    project = await createUserProject({
      userId,
      name,
      description: input.about?.trim() || null,
      slug,
      dirPath: dir,
      liveUrl: previewUrl,
      builderPref: "cloud",
      // A preview is built for a real business or person who has not said yes:
      // it stays off every public surface until they agree to be shown.
      clientWork: true,
    });
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    if (isUniqueViolation(e)) {
      return { ok: false, status: 409, error: `You already have a project called "${name}".` };
    }
    throw e;
  }
  const projectId = project.entityProjectId;
  if (!projectId) return { ok: false, status: 500, error: "The project was not created fully." };
  if (own) await setProjectPreviewCode(projectId, own);

  // The widget loads from Loki but runs on the preview's own address too.
  await upsertWidgetToken(userId, projectId, {
    origins: [new URL(appUrl()).origin, ...(host.ok ? [new URL(previewUrl).origin] : [])],
  });
  const ownerUrl = ownerSiteUrl(previewUrl, createOwnerPass(projectId, userId));

  if (input.archive) {
    return {
      ok: true,
      slug,
      projectId,
      previewUrl,
      ownerUrl,
      buildNote: null,
      addressNote,
      codeNote,
      accessCode,
    };
  }

  // Build on the box: the folder exists there and nowhere else
  // (execution-access.ts locks preview folders to the cloud builder).
  const { status, body } = await injectPrompt(
    {
      tab: project.name,
      projectId,
      allowHostedFallback: false,
      builderChannel: "cloud",
      customPrompt: input.prompt
        ? input.prompt(previewUrl)
        : previewBuildPrompt({ name, about: input.about, previewUrl }),
      notifyOnClose: true,
    },
    userId,
  );
  const started = status < 400 && typeof body.runId === "string";
  const buildNote = started
    ? null
    : typeof body.nextAction === "string"
      ? body.nextAction
      : typeof body.error === "string"
        ? body.error
        : "The build did not start. Open the project and start it from there.";

  return {
    ok: true,
    slug,
    projectId,
    previewUrl,
    ownerUrl,
    buildNote,
    addressNote,
    codeNote,
    accessCode,
  };
}
