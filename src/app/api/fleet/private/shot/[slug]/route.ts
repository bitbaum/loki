import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { getProjectPreviewCode } from "@/db/queries/preview-code";
import { findPreviewProject } from "@/db/queries/previews";
import { appUrl } from "@/lib/email";
import { takePagePicture } from "@/lib/feedback/page-picture";
import { withInFlight } from "@/lib/in-flight";
import { createPreviewAccessCookie, previewCodeFor } from "@/lib/previews/access";
import { PICTURE_REASON_HEADER } from "@/lib/previews/pictures";
import { previewDirFor } from "@/lib/previews/root";
import { loadFleetMap } from "@/lib/register/load-map";
import { privatePortfolio, type PrivatePortfolioEntry } from "@/lib/register/private-portfolio";
import { isAccessGate, TILE_SHOT_TTL_MS, tileShotPlan } from "@/lib/register/private-shot";
import { studioOwnerCheck } from "@/lib/register/studio-owner";

/**
 * GET /api/fleet/private/shot/<slug> — the screenshot on a private project's
 * tile, for the studio owner only (an <img> on bitbaum.orangecat.ch/private/,
 * which carries the Loki session cookie: the two hosts are the same site).
 * A 404 is what the tile turns into a text tile. Logic: lib/register/private-shot.
 */
export const dynamic = "force-dynamic";

const SHOTS_DIR = path.join(tmpdir(), "loki-private-shots");
const GATE_CHECK_MS = 5_000;
const NO_STORE = { "Cache-Control": "no-store", Vary: "Cookie" };

// The page asks for every tile's picture at once, and the map is a full
// register join (Solon included): one read serves the whole page.
const LIST_MEMO_MS = 60_000;
let listed: { at: number; value: Promise<PrivatePortfolioEntry[]> } | null = null;

function privateList(): Promise<PrivatePortfolioEntry[]> {
  if (listed && Date.now() - listed.at < LIST_MEMO_MS) return listed.value;
  const value = loadFleetMap("operator").then((map) => (map ? privatePortfolio(map) : []));
  listed = { at: Date.now(), value };
  value.catch(() => (listed = null));
  return value;
}

function none(status: number, reason: string) {
  return new Response(null, { status, headers: { ...NO_STORE, [PICTURE_REASON_HEADER]: reason } });
}

function jpeg(bytes: Uint8Array) {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/jpeg",
      // The owner's own browser keeps it; nothing between may.
      "Cache-Control": "private, max-age=21600",
      Vary: "Cookie",
    },
  });
}

async function fresh(file: string): Promise<Uint8Array | null> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || Date.now() - info.mtimeMs > TILE_SHOT_TTL_MS) return null;
  return new Uint8Array(await readFile(file));
}

async function previewCookie(slug: string, ownerId: string): Promise<string | null> {
  const dir = previewDirFor(slug);
  const project = dir ? await findPreviewProject(dir) : null;
  if (!project || project.userId !== ownerId) return null;
  const code = previewCodeFor(await getProjectPreviewCode(project));
  return code ? createPreviewAccessCookie(Date.now(), code) : null;
}

async function gated(url: string): Promise<boolean> {
  const res = await fetch(url, { signal: AbortSignal.timeout(GATE_CHECK_MS) }).catch(() => null);
  await res?.body?.cancel().catch(() => undefined);
  return res ? isAccessGate(res.headers) : false;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const owner = await studioOwnerCheck();
  if (!owner.ok) return none(owner.status, "not-owner");

  const { slug } = await params;
  const entry = (await privateList().catch(() => [])).find((p) => p.slug === slug);
  if (!entry?.live) return none(404, "no-site");

  const plan = tileShotPlan({
    slug,
    live: entry.live,
    appOrigin: new URL(appUrl()).origin,
    previewCookie: await previewCookie(slug, owner.userId),
  });
  const file = path.join(SHOTS_DIR, `${plan.key}.jpg`);
  const kept = await fresh(file);
  if (kept) return jpeg(kept);

  // The page asks for every tile at once; one picture per site at a time.
  return withInFlight(`private-shot:${plan.key}`, async () => {
    const taken = await fresh(file);
    if (taken) return jpeg(taken);
    if (!plan.opts.cookies && (await gated(plan.target))) return none(404, "behind-its-own-code");
    const shot = await takePagePicture(plan.target, null, plan.opts).catch(() => null);
    if (!shot?.ok)
      return none(404, shot ? `${shot.reason}${shot.detail ? `: ${shot.detail}` : ""}` : "failed");
    const bytes = new Uint8Array(Buffer.from(shot.base64, "base64"));
    await mkdir(SHOTS_DIR, { recursive: true }).catch(() => undefined);
    await writeFile(file, bytes).catch(() => undefined);
    return jpeg(bytes);
  });
}
