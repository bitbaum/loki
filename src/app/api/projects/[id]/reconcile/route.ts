import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSessionUserId } from "@/lib/session";
import { readIdParam } from "@/lib/api/route-helpers";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { fetchAttributesByEntityIds, upsertEntityAttribute } from "@/db/queries/utils";
import { patchProject } from "@/db/queries/projects";
import { reconcileProfile } from "@/lib/project-brief";
import { pastedText } from "@/lib/api/pasted-text";

// Sync-from-doc. Two phases so nothing is silently overwritten:
//   POST { text }                    → PREVIEW: diff the doc against current fields,
//                                       return { updates, newAttributes } (no writes)
//   POST { apply: { updates, newAttributes } } → APPLY only what the user approved.

const PreviewBody = z.object({ text: pastedText("Paste the doc — at least a sentence.") });
const ApplyBody = z.object({
  apply: z.object({
    updates: z.record(z.string(), z.string().trim().max(500)).default({}),
    newAttributes: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
          value: z.string().trim().min(1).max(500),
        }),
      )
      .max(3)
      .default([]),
  }),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const id = idOrResp;

  const entity = await db.query.entities.findFirst({
    where: and(
      eq(entities.id, id),
      eq(entities.userId, userId),
      eq(entities.type, ENTITY_TYPE.PROJECT),
    ),
    columns: { id: true, name: true, description: true },
  });
  if (!entity) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json().catch(() => ({}));

  // ── APPLY ──────────────────────────────────────────────────────────────────
  if (raw && typeof raw === "object" && "apply" in raw) {
    const parsed = ApplyBody.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "bad apply body" }, { status: 400 });
    const { updates, newAttributes } = parsed.data.apply;
    const applied: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === "description") {
        if (await patchProject(userId, id, { description: value })) applied.push("description");
      } else if (await upsertEntityAttribute(userId, id, key, value)) {
        applied.push(key);
      }
    }
    for (const attr of newAttributes) {
      if (await upsertEntityAttribute(userId, id, attr.key, attr.value)) applied.push(attr.key);
    }
    return NextResponse.json({ ok: true, applied });
  }

  // ── PREVIEW ────────────────────────────────────────────────────────────────
  const parsed = PreviewBody.safeParse(raw);
  // The schema's own message: "too long" and "too short" are different
  // problems, and this used to answer both with "at least a sentence".
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Paste the doc — at least a sentence." },
      { status: 400 },
    );

  const attrs = (await fetchAttributesByEntityIds([id])).get(id) ?? {};
  const currentFields: Record<string, string> = { ...attrs };
  if (entity.description) currentFields.description = entity.description;

  let patch;
  try {
    patch = await reconcileProfile(entity.name, currentFields, parsed.data.text);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not reconcile the doc. Try again in a moment.",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  // Enrich updates with the current value so the UI can show old → new.
  const updates = Object.entries(patch.updates).map(([key, proposed]) => ({
    key,
    current: currentFields[key] ?? null,
    proposed,
  }));
  const changedKeys = new Set(updates.map((u) => u.key));
  const unchangedCount = Object.keys(currentFields).filter((k) => !changedKeys.has(k)).length;

  return NextResponse.json({
    ok: true,
    updates,
    newAttributes: patch.newAttributes,
    unchangedCount,
  });
}
