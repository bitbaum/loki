/**
 * What each metered AI feature is, in the owner's words. Settings → AI listed
 * spend by codebase slug ("terminal-next-steps", "widget-advise"), which names
 * a file, not a thing the owner recognises. A slug with no entry here is
 * still shown, made readable ("chat-thread-title" → "Chat thread title").
 */
export const AI_FEATURE_LABELS: Record<string, string> = {
  "activity-digest": "Activity summaries",
  "business-plan": "Business plans",
  "calendar-extract": "Reading dates from messages",
  "chat-follow-ups": "Suggested follow-ups in chat",
  "chat-thread-title": "Naming your chats",
  "command-resolve": "Understanding typed commands",
  "feedback-read": "Reading feedback",
  "fix-verify": "Checking fixes",
  "form-assist": "Help filling in forms",
  "frontier-digest": "Research summaries",
  "frontier-judge": "Judging research ideas",
  "frontier-propose": "Proposing research ideas",
  "hosted-runner-analyze": "Checking Loki's computer",
  "instant-preview": "Instant previews",
  "loki-chat": "Chat with Loki",
  "loki-chat-fallback": "Chat with Loki (backup model)",
  "merge-prompts": "Combining instructions",
  "own-model-test": "Testing your own models",
  "project-brief": "Project briefs",
  "project-interview": "Project interviews",
  "proposal-extract": "Reading proposals",
  "site-review-discuss": "Site reviews",
  "terminal-next-steps": "Next-step suggestions in Terminal",
  "today-watch": "Today's overview",
  "watch-narrate": "Describing what agents do",
  "widget-advise": "Feedback widget: advice",
  "widget-chat": "Feedback widget: chat",
  "widget-preview": "Feedback widget: previews",
  "widget-tour": "Feedback widget: tours",
  "widget-understand": "Feedback widget: understanding requests",
};

export function aiFeatureLabel(id: string): string {
  const known = AI_FEATURE_LABELS[id];
  if (known) return known;
  const words = id.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}
