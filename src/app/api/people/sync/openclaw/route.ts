import { NextResponse } from "next/server";
import { homedir } from "os";
import { readFile } from "fs/promises";
import { requirePrivateApiAccess } from "@/lib/private-zone-api";
import { IMPORT_SOURCE } from "@/config/book";
import {
  parseContactResolver,
  parseKnowledgePeople,
  type ImportedContact,
} from "@/lib/people-import";
import { applyImportedBook } from "@/db/queries/people-book";
import { canImportSocial } from "@/config/actors";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { isSiteOperator } from "@/db/queries/users";

function resolverPath(): string {
  return (
    process.env.OPENCLAW_CONTACTS_PATH?.trim() ||
    `${homedir()}/.openclaw/workspace/data/contact-resolver.json`
  );
}

function knowledgeJsonPath(): string {
  return (
    process.env.OPENCLAW_KNOWLEDGE_JSON?.trim() ||
    `${homedir()}/.openclaw/workspace/data/knowledge-people.json`
  );
}

async function readKnowledgePeople(): Promise<ImportedContact[]> {
  // JSON only — better-sqlite3 is a native module and crashed the
  // standalone Node process on the box the first time we imported it.
  try {
    const text = await readFile(knowledgeJsonPath(), "utf8");
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { people?: unknown }).people)
        ? (parsed as { people: unknown[] }).people
        : [];
    return parseKnowledgePeople(
      rows.filter((r): r is { name: string; attrs?: Record<string, string> } =>
        Boolean(r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string"),
      ),
    );
  } catch {
    return [];
  }
}

export async function POST() {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  if (!canImportSocial(ENTITY_TYPE.PERSON)) {
    return NextResponse.json({ error: "People import is not allowed" }, { status: 403 });
  }
  // The files below are read from the SERVER's home directory, which holds the
  // site operator's own OpenClaw book — WhatsApp and Telegram contacts. Until
  // 2026-10-17 any signed-in account with its private zone open (a new one
  // has no PIN) could copy that book into its own. Theirs to sync, nobody
  // else's.
  if (!(await isSiteOperator(access.userId))) {
    return NextResponse.json(
      { error: "There is no OpenClaw book for this account. Use Import address book." },
      { status: 403 },
    );
  }

  let text: string | null = null;
  try {
    text = await readFile(resolverPath(), "utf8");
  } catch {
    text = null;
  }

  const fromResolver = text ? parseContactResolver(text) : [];
  const fromKnowledge = await readKnowledgePeople();
  const contacts = [...fromResolver, ...fromKnowledge];
  if (contacts.length === 0) {
    return NextResponse.json(
      {
        error:
          "OpenClaw book not on this server. Upload contact-resolver.json with Import address book.",
        path: resolverPath(),
      },
      { status: 404 },
    );
  }

  let offset = 0;
  let created = 0;
  let enriched = 0;
  let skipped = 0;
  let done = false;
  while (!done) {
    const chunk = await applyImportedBook(access.userId, contacts, offset);
    created += chunk.created;
    enriched += chunk.enriched;
    skipped += chunk.skipped;
    offset = chunk.nextOffset;
    done = chunk.done;
  }

  return NextResponse.json({
    ok: true,
    source: IMPORT_SOURCE.CONTACT_RESOLVER,
    parsed: contacts.length,
    created,
    enriched,
    skipped,
    knowledge: fromKnowledge.length,
  });
}
