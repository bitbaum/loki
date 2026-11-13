/**
 * What each of Loki's tools is called on screen.
 *
 * SSOT so the work trail never shows a raw handler name. `search_knowledge`
 * tells the operator nothing about what just happened to their data;
 * "Searched your knowledge graph" does. Names not listed here fall back to the
 * handler name with underscores opened up, which is ugly on purpose — a new
 * tool should get a line here rather than quietly shipping plumbing.
 */
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_people: { running: "Searching your people", done: "Searched your people" },
  list_projects: { running: "Reading your projects", done: "Read your projects" },
  search_knowledge: { running: "Searching your knowledge", done: "Searched your knowledge" },
  list_goals: { running: "Reading your goals", done: "Read your goals" },
  list_habits: { running: "Reading your habits", done: "Read your habits" },
  list_commitments: { running: "Reading your commitments", done: "Read your commitments" },
  list_pending_approvals: {
    running: "Checking your approval queue",
    done: "Checked your approval queue",
  },
  ask_openclaw: { running: "Asking the fleet agent", done: "Asked the fleet agent" },
  propose_action: { running: "Drafting an action", done: "Drafted an action for approval" },
  list_crew: { running: "Reading your crew", done: "Read your crew" },
  list_human_tasks: { running: "Reading handed-over work", done: "Read handed-over work" },
  propose_human_task: { running: "Drafting an assignment", done: "Drafted an assignment" },
  // The rest of the handlers (lib/agent/tools): the answer's footer read
  // "used fleet_status, search_knowledge, list_runs" (owner audit, 2026-11-12).
  list_feedback: { running: "Reading the reports", done: "Read the reports" },
  list_runs: { running: "Reading recent work", done: "Read recent work" },
  list_active_agents: { running: "Checking who is working", done: "Checked who is working" },
  fleet_status: { running: "Checking your projects", done: "Checked your projects" },
  list_alerts: { running: "Reading your alerts", done: "Read your alerts" },
  list_notes: { running: "Reading your notes", done: "Read your notes" },
  set_away: { running: "Setting you away", done: "Set you away" },
  fill_web_form: { running: "Filling in a form", done: "Filled in a form" },
  suggest_builds: { running: "Looking for what to build", done: "Found what to build next" },
  create_website: { running: "Starting a website", done: "Started a website" },
  set_preview_code: { running: "Setting the preview code", done: "Set the preview code" },
  read_website: { running: "Reading the website", done: "Read the website" },
};

export function toolLabel(name: string, phase: "start" | "end" | "fail"): string {
  const entry = TOOL_LABELS[name];
  if (!entry) return name.replace(/_/g, " ");
  return phase === "start" ? entry.running : entry.done;
}
