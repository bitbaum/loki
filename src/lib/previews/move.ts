/**
 * Move a preview to a new address, and give it its right name.
 *
 * A preview's address is its folder and its subdomain, and both were chosen
 * at creation — from a name typed in a hurry, or from the old site's domain,
 * which may itself be wrong. Center SOM's site lives at center-com.ru because
 * "СОМ" was spelled in Latin letters that look alike; the preview inherited
 * that as center-com-3. The person it is for must be sent the right name, so
 * the address, the folder and the project's name move together, and the old
 * address is taken away rather than left answering for a project that moved.
 *
 * Order matters: everything that can refuse comes first, then the new address
 * is attached (nothing else has changed if that fails), then the folder and
 * the record move together — the folder moves back if the record cannot.
 */
import { existsSync } from "fs";
import { rename } from "fs/promises";
import path from "path";
import { isProjectNameTaken } from "@/db/queries/brief-projects";
import { findPreviewProject, movePreviewProject } from "@/db/queries/previews";
import { upsertWidgetToken } from "@/db/queries/widget-tokens";
import { appUrl } from "@/lib/email";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { isPreviewAddress } from "@/lib/previews/address";
import { attachPreviewHost, detachPreviewHost } from "@/lib/previews/host";
import { previewsRoot } from "@/lib/previews/root";

export type MovePreviewResult =
  | {
      ok: true;
      slug: string;
      name: string;
      previewUrl: string;
      /** Null when the old address is gone; otherwise why it still answers. */
      oldAddressNote: string | null;
    }
  | { ok: false; status: number; error: string };

export async function movePreview(
  userId: string,
  from: string,
  input: { to: string; name?: string },
): Promise<MovePreviewResult> {
  if (!(await isFleetInfrastructureAllowed(userId)))
    return {
      ok: false,
      status: 403,
      error: "Previews live on Loki's own computers, which this account does not have.",
    };
  const root = previewsRoot();
  if (!root) return { ok: false, status: 503, error: "Previews are not set up on this server." };

  const to = input.to.trim().toLowerCase();
  if (!isPreviewAddress(to))
    return {
      ok: false,
      status: 400,
      error: "An address is lowercase letters, digits and dashes, and not a reserved name.",
    };
  if (!isPreviewAddress(from))
    return { ok: false, status: 404, error: "No such preview of yours." };
  const fromDir = path.join(root, from);
  const toDir = path.join(root, to);
  const project = await findPreviewProject(fromDir);
  if (!project || project.userId !== userId || !existsSync(fromDir))
    return { ok: false, status: 404, error: "No such preview of yours." };
  if (to !== from && existsSync(toDir))
    return { ok: false, status: 409, error: `${to} is already taken. Pick another address.` };

  const name = input.name?.trim() || project.name;
  if (name.toLowerCase() !== project.name.toLowerCase() && (await isProjectNameTaken(name)))
    return { ok: false, status: 409, error: `There is already a project called "${name}".` };

  const host = await attachPreviewHost(to);
  if (!host.ok)
    return { ok: false, status: 502, error: `The new address could not be set up: ${host.reason}` };

  if (to !== from) await rename(fromDir, toDir);
  const moved = await movePreviewProject(userId, fromDir, {
    dirPath: toDir,
    slug: to,
    liveUrl: host.url,
    name,
  }).catch(() => false);
  if (!moved) {
    if (to !== from) await rename(toDir, fromDir).catch(() => undefined);
    return { ok: false, status: 500, error: "The project could not be moved. Nothing changed." };
  }

  // The widget runs on the new address; the old one no longer serves it.
  if (project.entityProjectId)
    await upsertWidgetToken(userId, project.entityProjectId, {
      origins: [new URL(appUrl()).origin, new URL(host.url).origin],
    });

  const detached = to === from ? { ok: true as const } : await detachPreviewHost(from);
  return {
    ok: true,
    slug: to,
    name,
    previewUrl: host.url,
    oldAddressNote: detached.ok ? null : `The old address still answers: ${detached.reason}`,
  };
}
