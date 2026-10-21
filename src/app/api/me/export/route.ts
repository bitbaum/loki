import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  userPreferences,
  notificationPreferences,
  beaconSettings,
  userProjects,
  projectStates,
  orchestrationRuns,
  promptHistory,
  prompts,
  conversations,
  conversationMessages,
  agentMessages,
  entities,
  entityRelations,
  attributes,
  interactions,
  goals,
  commitments,
  habits,
  habitCompletions,
  events,
  actions,
  alerts,
  captures,
  subscriptions,
  siteFeedback,
  claudeCodeHistory,
  knowledgeEmbeddings,
  ocBillingGrants,
} from "@/db/schema";
import { requirePrivateApiAccess } from "@/lib/private-zone-api";
import { ACCOUNT_EXPORT_FILENAME, buildExportManifest, toExportUser } from "@/lib/account-export";

/**
 * GET /api/me/export — download everything the platform stores about the
 * requesting user, as JSON (GDPR / Swiss-DSG right of access).
 *
 * PIN-gated (requirePrivateApiAccess) because the payload spans the private
 * zone: people, goals, habits, money, and the derived knowledge graph. All
 * reads are scoped by the session's userId; the users row is projected through
 * toExportUser — the same schema-exhaustive allow-list `/api/me` uses, minus
 * billing ids (see user-client-view.ts).
 */
export async function GET() {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const [
    userRows,
    prefs,
    notifPrefs,
    beacon,
    projects,
    states,
    runs,
    promptHist,
    promptRows,
    convs,
    agentMsgs,
    ents,
    rels,
    attrs,
    inters,
    goalRows,
    commitmentRows,
    habitRows,
    habitCompletionRows,
    eventRows,
    actionRows,
    alertRows,
    captureRows,
    subscriptionRows,
    feedbackRows,
    historyRows,
    knowledgeRows,
    grantRows,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)),
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
    db.select().from(beaconSettings).where(eq(beaconSettings.userId, userId)),
    db.select().from(userProjects).where(eq(userProjects.userId, userId)),
    db.select().from(projectStates).where(eq(projectStates.userId, userId)),
    db.select().from(orchestrationRuns).where(eq(orchestrationRuns.userId, userId)),
    db.select().from(promptHistory).where(eq(promptHistory.userId, userId)),
    db.select().from(prompts).where(eq(prompts.userId, userId)),
    db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.ephemeral, false))),
    db.select().from(agentMessages).where(eq(agentMessages.userId, userId)),
    db.select().from(entities).where(eq(entities.userId, userId)),
    db.select().from(entityRelations).where(eq(entityRelations.userId, userId)),
    db.select().from(attributes).where(eq(attributes.userId, userId)),
    db.select().from(interactions).where(eq(interactions.userId, userId)),
    db.select().from(goals).where(eq(goals.userId, userId)),
    db.select().from(commitments).where(eq(commitments.userId, userId)),
    db.select().from(habits).where(eq(habits.userId, userId)),
    db.select().from(habitCompletions).where(eq(habitCompletions.userId, userId)),
    db.select().from(events).where(eq(events.userId, userId)),
    db.select().from(actions).where(eq(actions.userId, userId)),
    db.select().from(alerts).where(eq(alerts.userId, userId)),
    db.select().from(captures).where(eq(captures.userId, userId)),
    db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
    db.select().from(siteFeedback).where(eq(siteFeedback.userId, userId)),
    db.select().from(claudeCodeHistory).where(eq(claudeCodeHistory.userId, userId)),
    db
      .select({
        sourceType: knowledgeEmbeddings.sourceType,
        sourceId: knowledgeEmbeddings.sourceId,
        chunk: knowledgeEmbeddings.chunk,
        metadata: knowledgeEmbeddings.metadata,
        updatedAt: knowledgeEmbeddings.updatedAt,
      })
      .from(knowledgeEmbeddings)
      .where(eq(knowledgeEmbeddings.userId, userId)),
    db.select().from(ocBillingGrants).where(eq(ocBillingGrants.userId, userId)),
  ]);

  // Conversation messages join via conversation ownership.
  const convIds = convs.map((c) => c.id);
  const convMsgs =
    convIds.length === 0
      ? []
      : (
          await Promise.all(
            convIds.map((id) =>
              db
                .select()
                .from(conversationMessages)
                .where(eq(conversationMessages.conversationId, id)),
            ),
          )
        ).flat();

  const sections = [
    "user (redacted)",
    "preferences",
    "notification_preferences",
    "beacon_settings",
    "projects",
    "project_states",
    "orchestration_runs",
    "prompt_history",
    "prompts",
    "conversations",
    "conversation_messages",
    "agent_messages",
    "memory: entities / relations / attributes / interactions",
    "goals",
    "commitments",
    "habits",
    "habit_completions",
    "events",
    "actions",
    "alerts",
    "captures",
    "subscriptions",
    "site_feedback",
    "claude_code_history",
    "knowledge_index (chunks + metadata, no vectors)",
    "billing_grants",
  ];

  const payload = {
    manifest: buildExportManifest(userId, sections),
    user: userRows.map(toExportUser),
    preferences: prefs,
    notification_preferences: notifPrefs,
    beacon_settings: beacon,
    projects,
    project_states: states,
    orchestration_runs: runs,
    prompt_history: promptHist,
    prompts: promptRows,
    conversations: convs,
    conversation_messages: convMsgs,
    agent_messages: agentMsgs,
    memory: { entities: ents, relations: rels, attributes: attrs, interactions: inters },
    goals: goalRows,
    commitments: commitmentRows,
    habits: habitRows,
    habit_completions: habitCompletionRows,
    events: eventRows,
    actions: actionRows,
    alerts: alertRows,
    captures: captureRows,
    subscriptions: subscriptionRows,
    site_feedback: feedbackRows,
    claude_code_history: historyRows,
    knowledge_index: knowledgeRows,
    billing_grants: grantRows,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${ACCOUNT_EXPORT_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
