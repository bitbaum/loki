import type { Action } from "@/db/schema/actions";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import { markActionExecuted } from "@/db/queries/actions";
import { createCommitment } from "@/db/queries/today";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { patchProject } from "@/db/queries/projects";
import { upsertEntityAttribute } from "@/db/queries/utils";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";

import { bookCalendarEvent, type EventRecovery } from "@/lib/actions/calendar-event";
import { notifyActionExecuted } from "@/lib/actions/notify-decision";
import { isRuntimeAvailable } from "@/lib/runtime";
import { injectPrompt } from "@/lib/inject-core";
import { markFeedbackDispatchedBulk } from "@/db/queries/site-feedback";
import { applyEnrichment, applyImportedContact } from "@/db/queries/people-book";
import { mergePeoplePair } from "@/db/queries/people-merge";
import type { ImportedContact } from "@/lib/people-import";
import type { ImportSource } from "@/config/book";

export type ExecuteActionOptions = {
  /**
   * Approval came from a standing rule, not a tap. Carried only so the
   * confirmation message can SAY so — it never changes what is executed. An
   * action reaching this function has been approved; how is the operator's
   * business, not the executor's.
   */
  autoApproved?: boolean;
  /**
   * How to recover a calendar event's date from free text when the payload has
   * no structured fields — a model call. Only a caller acting on a person's tap
   * passes it; a standing rule runs from a cron tick and must not spend the
   * shared free tier, so it books structured events only.
   */
  recoverEvent?: EventRecovery;
};

export type ExecuteActionResult = {
  /** true only when a real-world effect happened and the row reached status='executed'. */
  executed: boolean;
  /** true when the action type has no executor wired yet (left 'approved', nothing happened). */
  deferred?: boolean;
  /** populated when a wired executor threw (row left 'approved' for retry). */
  error?: string;
  /** Dispatch destination — so the UI can send the operator there. */
  projectKey?: string;
  runId?: string | null;
};

/** Action types whose executor isn't wired yet. Fail-closed: they pass the human
 *  gate but do nothing at execution until built. SEND_MESSAGE (Telegram),
 *  SEND_EMAIL (Resend) and CREATE_EVENT (gog calendar create) are now wired —
 *  see the switch below. */
const DEFERRED_TYPES = new Set<Action["type"]>([ACTION_TYPE.FOLLOW_UP, ACTION_TYPE.OTHER]);

type ProfileUpdatePayload = {
  kind: "profile_update";
  projectKey: string;
  fieldKey: string;
  value: string;
};

function parseProfileUpdatePayload(payload: Action["payload"]): ProfileUpdatePayload | null {
  if (!payload || payload.kind !== "profile_update") return null;
  const fieldKey = typeof payload.fieldKey === "string" ? payload.fieldKey.trim() : "";
  const value = typeof payload.value === "string" ? payload.value.trim() : "";
  const projectKey = typeof payload.projectKey === "string" ? payload.projectKey.trim() : "";
  if (!fieldKey || !value || !projectKey) return null;
  return { kind: "profile_update", fieldKey, value, projectKey };
}

async function executeProfileUpdate(
  userId: string,
  action: Action,
  update: ProfileUpdatePayload,
): Promise<ExecuteActionResult> {
  const entityId = action.entityId;
  if (!entityId) {
    await recordActionAuditEvent(userId, action, "failed", {
      reason: "profile_update missing entityId",
    });
    return { executed: false, error: "missing-entity" };
  }

  try {
    if (update.fieldKey === "description") {
      const updated = await patchProject(userId, entityId, { description: update.value });
      if (!updated) {
        await recordActionAuditEvent(userId, action, "failed", {
          reason: "project not found for description update",
        });
        return { executed: false, error: "not-found" };
      }
    } else {
      const ok = await upsertEntityAttribute(userId, entityId, update.fieldKey, update.value);
      if (!ok) {
        await recordActionAuditEvent(userId, action, "failed", {
          reason: "project not found for attribute update",
        });
        return { executed: false, error: "not-found" };
      }
    }

    scheduleProjectProfileReindexByEntityId(userId, entityId);

    const done = await markActionExecuted(action.id, userId);
    if (!done) {
      await recordActionAuditEvent(userId, action, "failed", {
        reason: "profile updated but action was not in 'approved' state to mark executed",
      });
      return { executed: false, error: "not-approved-at-execute-time" };
    }
    await recordActionAuditEvent(userId, action, "executed", {
      meta: { fieldKey: update.fieldKey, projectKey: update.projectKey },
    });
    return { executed: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordActionAuditEvent(userId, action, "failed", { reason: error });
    return { executed: false, error };
  }
}

/**
 * Perform an APPROVED action's real-world effect, then advance it to 'executed'.
 *
 * Contract (fail-closed): an action only reaches status='executed' on a real,
 * successful effect. Unimplemented types are DEFERRED (left 'approved', audited);
 * a wired executor that throws is caught, audited as 'failed', and left 'approved'
 * for retry. A wrong/duplicate real send is the worst outcome — when in doubt we
 * do NOT act. The caller must have already approved the action (IRON RULE).
 */
export async function executeAction(
  userId: string,
  action: Action,
  opts: ExecuteActionOptions = {},
): Promise<ExecuteActionResult> {
  const profileUpdate =
    action.type === ACTION_TYPE.OTHER ? parseProfileUpdatePayload(action.payload) : null;
  if (profileUpdate) {
    return executeProfileUpdate(userId, action, profileUpdate);
  }

  // External/irreversible types: gate passes, execution intentionally not yet enabled.
  if (DEFERRED_TYPES.has(action.type)) {
    await recordActionAuditEvent(userId, action, "deferred", {
      reason: `executor not yet enabled for type=${action.type}`,
    });
    return { executed: false, deferred: true };
  }

  try {
    switch (action.type) {
      case ACTION_TYPE.CREATE_COMMITMENT: {
        // Internal, reversible: writes to Loki's own commitments table. Zero external risk.
        const payload = action.payload ?? {};
        const description =
          (typeof payload.commitment === "string" && payload.commitment.trim()) || action.title;
        const dueDate = typeof payload.dueDate === "string" ? payload.dueDate : undefined;
        const financialImpact =
          typeof payload.financialImpact === "string" ? payload.financialImpact : undefined;

        await createCommitment(userId, { description, dueDate, financialImpact }, "ivy-action");
        const done = await markActionExecuted(action.id, userId);
        if (!done) {
          // Lost the approved→executed guard (e.g. already executed); commitment was still created.
          await recordActionAuditEvent(userId, action, "failed", {
            reason: "commitment created but action was not in 'approved' state to mark executed",
          });
          return { executed: false, error: "not-approved-at-execute-time" };
        }
        await recordActionAuditEvent(userId, action, "executed");
        return { executed: true };
      }

      case ACTION_TYPE.DISPATCH_PROMPT: {
        // Approve → run: inject the exact prompt the operator approved into
        // the project, through the same injectPrompt SSOT as every manual
        // dispatch. The approval IS the gate — proposals carry the full prompt
        // in the payload so the operator reviews precisely what will run.
        const payload = action.payload ?? {};
        const projectKey = typeof payload.projectKey === "string" ? payload.projectKey.trim() : "";
        const prompt = typeof payload.body === "string" ? payload.body.trim() : "";
        if (!projectKey || !prompt) {
          await recordActionAuditEvent(userId, action, "failed", {
            reason: "dispatch_prompt payload missing projectKey or body",
          });
          return { executed: false, error: "invalid dispatch_prompt payload" };
        }

        const { status, body } = await injectPrompt(
          { tab: projectKey, customPrompt: prompt },
          userId,
        );
        if (status >= 400) {
          const reason =
            typeof body.error === "string" ? body.error : `dispatch failed (${status})`;
          await recordActionAuditEvent(userId, action, "failed", { reason });
          return { executed: false, error: reason };
        }

        const runId = typeof body.runId === "string" ? body.runId : null;
        // Digester proposals carry the clustered feedback ids: flip them to
        // 'dispatched' with the run id so close-the-loop can auto-resolve them
        // when the run succeeds. Best-effort — the dispatch already happened,
        // so a linkage failure must not fail the action.
        const feedbackIds = Array.isArray(payload.feedbackIds)
          ? payload.feedbackIds.filter((x): x is string => typeof x === "string")
          : [];
        let feedbackLinked = 0;
        if (feedbackIds.length > 0) {
          try {
            feedbackLinked = await markFeedbackDispatchedBulk(
              userId,
              feedbackIds,
              runId ?? undefined,
            );
          } catch {
            /* audited via feedbackLinked=0 below */
          }
        }

        const done = await markActionExecuted(action.id, userId);
        if (!done) {
          await recordActionAuditEvent(userId, action, "failed", {
            reason: "dispatched but action was not in 'approved' state to mark executed",
          });
          return { executed: false, error: "not-approved-at-execute-time" };
        }
        await recordActionAuditEvent(userId, action, "executed", {
          meta: { runId, feedbackLinked },
        });
        return { executed: true, projectKey, runId };
      }

      case ACTION_TYPE.CREATE_EVENT: {
        // External but reversible (an event can be deleted). Booked via the
        // locally-authenticated `gog` CLI — which only exists on the local
        // runtime. When approval happens on the cloud control plane (no gog),
        // we do NOT fake success: leave the row 'approved' and audit it as
        // deferred with an honest reason. The local runtime's calendar drain
        // (see api/actions/drain-events) picks it up and books it for real.
        if (!isRuntimeAvailable()) {
          await recordActionAuditEvent(userId, action, "deferred", {
            // The drain needs to know an auto-approved row must still announce
            // itself when it books — it is not in this process, and 'approved'
            // alone does not say who approved it.
            reason: "calendar runtime offline — awaiting local runtime to book via gog",
            meta: { autoApproved: opts.autoApproved === true },
          });
          return { executed: false, deferred: true };
        }

        const booked = await bookCalendarEvent(action.payload, action.title, opts.recoverEvent);
        if (!booked.ok) {
          await recordActionAuditEvent(userId, action, "failed", { reason: booked.error });
          return { executed: false, error: booked.error };
        }

        const done = await markActionExecuted(action.id, userId);
        if (!done) {
          await recordActionAuditEvent(userId, action, "failed", {
            reason: "event booked but action was not in 'approved' state to mark executed",
          });
          return { executed: false, error: "not-approved-at-execute-time" };
        }
        await recordActionAuditEvent(userId, action, "executed", {
          meta: { eventId: booked.eventId ?? null, htmlLink: booked.htmlLink ?? null },
        });
        // Confirm the EFFECT, not the decision. This is the message the
        // operator was actually waiting for — and with a standing rule it is
        // the only one they get, so it is the whole review surface.
        await notifyActionExecuted(userId, action, {
          htmlLink: booked.htmlLink ?? null,
          autoApproved: opts.autoApproved,
        }).catch(() => {});
        return { executed: true };
      }

      case ACTION_TYPE.IMPORT_PERSON: {
        const payload = action.payload ?? {};
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        if (!name) {
          await recordActionAuditEvent(userId, action, "failed", { reason: "import missing name" });
          return { executed: false, error: "invalid import payload" };
        }
        const contact: ImportedContact = {
          name,
          description: typeof payload.description === "string" ? payload.description : undefined,
          attrs: isRecord(payload.attrs) ? stringRecord(payload.attrs) : {},
          externalId: typeof payload.externalId === "string" ? payload.externalId : undefined,
          source: (typeof payload.source === "string"
            ? payload.source
            : "internal") as ImportSource,
        };
        await applyImportedContact(userId, contact);
        return finishExecuted(userId, action);
      }

      case ACTION_TYPE.ENRICH_PERSON: {
        const payload = action.payload ?? {};
        const key = typeof payload.key === "string" ? payload.key : "";
        const value = typeof payload.value === "string" ? payload.value : "";
        if (!action.entityId || !key || !value) {
          await recordActionAuditEvent(userId, action, "failed", {
            reason: "enrich missing field",
          });
          return { executed: false, error: "invalid enrich payload" };
        }
        await applyEnrichment(userId, action.entityId, key, value);
        return finishExecuted(userId, action);
      }

      case ACTION_TYPE.MERGE_PEOPLE: {
        const payload = action.payload ?? {};
        const keepId = typeof payload.keepId === "string" ? payload.keepId : "";
        const dropId = typeof payload.dropId === "string" ? payload.dropId : "";
        if (!keepId || !dropId) {
          await recordActionAuditEvent(userId, action, "failed", { reason: "merge missing ids" });
          return { executed: false, error: "invalid merge payload" };
        }
        await mergePeoplePair(userId, keepId, dropId);
        return finishExecuted(userId, action);
      }

      case ACTION_TYPE.SEND_MESSAGE:
      case ACTION_TYPE.SEND_EMAIL: {
        await recordActionAuditEvent(userId, action, "deferred", {
          reason:
            "outbound send frozen — profiles first, no messages while the book is being built",
        });
        return { executed: false, deferred: true };
      }

      default: {
        // Unknown/unhandled type — fail closed rather than silently succeed.
        await recordActionAuditEvent(userId, action, "deferred", {
          reason: `no executor for type=${action.type}`,
        });
        return { executed: false, deferred: true };
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordActionAuditEvent(userId, action, "failed", { reason: error });
    return { executed: false, error };
  }
}

async function finishExecuted(userId: string, action: Action): Promise<ExecuteActionResult> {
  const done = await markActionExecuted(action.id, userId);
  if (!done) {
    await recordActionAuditEvent(userId, action, "failed", {
      reason: "effect applied but action was not in 'approved' state to mark executed",
    });
    return { executed: false, error: "not-approved-at-execute-time" };
  }
  await recordActionAuditEvent(userId, action, "executed");
  return { executed: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}
