import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { KEY_SAVES_PER_HOUR, NPM_PUBLISH_MESSAGES, SaveNpmKeyBody } from "@/config/npm-publishing";
import {
  deleteNpmPublishKey,
  getNpmPublishKey,
  saveNpmPublishKey,
} from "@/db/queries/npm-publish-keys";
import { sealSecret } from "@/lib/secret-box";
import { getPackageCatalogue } from "@/lib/packages/catalogue";
import { keyUsable, npmHasPackage, npmKeyOwner } from "@/lib/packages/npm-publish-rules";
import { runFirstPublishes } from "@/lib/packages/npm-publish";

/**
 * The npm panel on /packages (src/lib/packages/npm-publish.ts).
 *
 * GET: whether a key is saved, whose and until when — never the key — and
 * which catalogue packages npm does not know yet.
 * POST: check a pasted key with npm, keep it sealed, and start the first
 * publish of every package waiting for one.
 * DELETE: forget the key.
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const [row, { packages }] = await Promise.all([getNpmPublishKey(userId), getPackageCatalogue()]);
  const known = await Promise.all(packages.map((p) => npmHasPackage(p.name)));
  const now = new Date();
  return jsonOk({
    key: row
      ? {
          npmUser: row.npmUser,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          usable: keyUsable(row.expiresAt, now),
        }
      : null,
    notOnNpm: packages.filter((p, i) => p.repo && known[i] === false).map((p) => p.name),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!checkRateLimit(`npm-key:${userId}`, KEY_SAVES_PER_HOUR, 3_600_000)) {
    return jsonError(NPM_PUBLISH_MESSAGES.rateLimited, 429);
  }
  const body = await readJsonBody(req, SaveNpmKeyBody);
  if (body instanceof NextResponse) return body;
  const owner = await npmKeyOwner(body.key);
  if (!owner.ok) return jsonError(NPM_PUBLISH_MESSAGES[owner.reason], 400);
  await saveNpmPublishKey({
    userId,
    sealed: sealSecret(body.key),
    npmUser: owner.user,
    expiresAt: new Date(Date.now() + body.days * 86_400_000),
  });
  const run = await runFirstPublishes(userId);
  return jsonOk({ npmUser: owner.user, results: run.ok ? run.results : [] });
}

export async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  await deleteNpmPublishKey(userId);
  return jsonOk({});
}
