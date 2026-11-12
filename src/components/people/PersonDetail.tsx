"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Pencil } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageLayout } from "@/components/ui/page-layout";
import { Section as PageSection } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { DeleteButton } from "@/components/ui/delete-button";
import {
  SheetAction,
  SheetActions,
  SHEET_ACTION,
  SHEET_ACTION_DANGER,
} from "@/components/ui/detail-sheet";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { deriveRelationshipHealth, HEALTH_LABEL } from "@/lib/constants/people";
import { isChannelAttrKey } from "@/config/channels";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { patchJson, deleteJson, throwApiError } from "@/lib/api/fetch";
import { InteractionsSection } from "./PersonInteractionsSection";
import { DetailAttrs } from "./PersonDetailAttrs";
import { ChannelsSection } from "./PersonChannelsSection";
import { parseAliases, formatKey, type PersonDetailData } from "./person-detail-types";

/**
 * A person's own page (/people/[id]). One line on where things stand with
 * them, your note, how to reach them, the conversations you have logged, the
 * rest of what you know — each a plain section, no boxes — and what you can do
 * with them as rows at the end. It used to be a drawer's markup on a page: a
 * sticky header with an unlabelled send arrow, a bare trash glyph and a close
 * button that went back.
 */
export function PersonDetail({ person }: { person: PersonDetailData }) {
  const router = useRouter();
  const [name, setName] = useState(person.name);
  const [description, setDescription] = useState(person.description);
  const [attrs, setAttrs] = useState(person.attrs);
  const [interactions, setInteractions] = useState(person.interactions);
  const nameEdit = useInlineEdit<string>(person.name);
  const descEdit = useInlineEdit<string>(person.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const last = interactions[0] ? new Date(interactions[0].occurredAt) : null;
  const health = deriveRelationshipHealth(last);
  const status = last
    ? `${HEALTH_LABEL[health]} · last talked ${formatDistanceToNow(last, { addSuffix: true })}`
    : "No conversation logged yet";
  const profession = attrs["profession"] ?? attrs["role"];
  const location = attrs["location"] ?? attrs["home_location"];
  const reachable = Object.keys(attrs).some(isChannelAttrKey);

  const patch = async (body: Record<string, unknown>) => {
    const res = await patchJson(`/api/people/${person.id}`, body);
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Could not save — try again");
  };

  const commitName = () => {
    const trimmed = nameEdit.draft.trim();
    if (!trimmed || trimmed === name) {
      nameEdit.cancel();
      return;
    }
    setError(null);
    nameEdit
      .commit(async () => {
        await patch({ name: trimmed });
        setName(trimmed);
        router.refresh();
      })
      .then((ok) => {
        if (!ok) setError("Could not rename — that name may already be in your book.");
      });
  };

  const commitDescription = () => {
    const trimmed = descEdit.draft.trim();
    setError(null);
    descEdit
      .commit(async () => {
        await patch({ description: trimmed });
        setDescription(trimmed || null);
      })
      .then((ok) => {
        if (!ok) setError("Could not save the note — try again");
      });
  };

  const lokiPrompt = [
    `Person: ${name}`,
    profession && `Role: ${profession}`,
    location && `Location: ${location}`,
    description && `Notes: ${description}`,
    last
      ? `Last contact: ${formatDistanceToNow(last, { addSuffix: true })} (${interactions.length} conversations logged)`
      : "No recorded conversations",
    "",
    "What do you know about this person? What would be a good next step with them?",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <PageLayout title={name} back={{ href: "/people", label: "People" }} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {nameEdit.editing && (
          <input
            value={nameEdit.draft}
            onChange={(e) => nameEdit.setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") nameEdit.cancel();
            }}
            autoFocus
            aria-label="Name"
            className="ui-input"
          />
        )}
        <p className="ui-life-summary">
          {[profession, location].filter(Boolean).join(" · ")}
          {(profession || location) && <br />}
          {status}
        </p>
        {error && <p className="ui-error-xs">{error}</p>}
      </div>

      <PageSection title="Your note">
        {descEdit.editing ? (
          <div className="space-y-2">
            <textarea
              value={descEdit.draft}
              onChange={(e) => descEdit.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") descEdit.cancel();
                if (e.key === "Enter" && e.metaKey) commitDescription();
              }}
              autoFocus
              rows={4}
              placeholder="How you know them, what they care about"
              className="ui-input resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={commitDescription}
                disabled={descEdit.saving}
                className="ui-btn-secondary"
              >
                {descEdit.saving ? <Loader2 className="ui-spinner-xs" /> : "Save"}
              </button>
              <button type="button" onClick={descEdit.cancel} className="ui-btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => descEdit.start(description ?? "")}
            className="ui-life-editable"
          >
            {description ? (
              <span className="ui-life-prose">{description}</span>
            ) : (
              <span className="ui-life-prose-empty">Add a note</span>
            )}
          </button>
        )}
      </PageSection>

      <ChannelsSection personId={person.id} attrs={attrs} onUpdate={setAttrs} />
      {!reachable && (
        <p className="-mt-4 text-sm text-text-tertiary">
          Without one, this is only a name — Loki cannot remind you how to reach them.
        </p>
      )}

      <InteractionsSection
        personId={person.id}
        interactions={interactions}
        onAdd={(ix) => setInteractions((prev) => [ix, ...prev])}
      />

      <DetailAttrs personId={person.id} attrs={attrs} onUpdate={setAttrs} />

      {attrs["aliases"] && (
        <PageSection title="Also known as">
          <p className="text-base text-text-primary">
            {parseAliases(attrs["aliases"]).join(" · ")}
          </p>
        </PageSection>
      )}

      {person.relations.length > 0 && (
        <PageSection title="Connected to">
          <List aria-label="Connections">
            {person.relations.map((rel, i) => (
              <ListRow
                key={`${rel.targetId}:${i}`}
                href={rel.targetType === "person" ? `/people/${rel.targetId}` : undefined}
                icon={Link2}
                title={rel.targetName}
                secondary={formatKey(rel.type)}
                chevron={rel.targetType === "person"}
              />
            ))}
          </List>
        </PageSection>
      )}

      <PageSection title="Actions">
        <SheetActions>
          <SheetAction icon={Pencil} onClick={() => nameEdit.start(name)}>
            Rename
          </SheetAction>
          <LokiDispatchButton
            prompt={lokiPrompt}
            title="Ask Loki about this person"
            label="Ask Loki about them"
            className={SHEET_ACTION}
          />
          <DeleteButton
            onDelete={async () => {
              const res = await deleteJson(`/api/people/${person.id}`);
              if (!res.ok) await throwApiError(res, "Could not delete — try again");
              router.push("/people");
              router.refresh();
            }}
            label={`Delete ${name} and everything noted about them?`}
            triggerTitle="Delete person"
            triggerLabel="Delete from your book"
            triggerClassName={SHEET_ACTION_DANGER}
          />
        </SheetActions>
      </PageSection>
    </PageLayout>
  );
}
