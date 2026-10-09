"use client";

import { Plus, X, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { ControlData } from "@/lib/control-types";
import { PROMPT_TEMPLATES } from "@/config/prompt-library";

type AgentEntry = ControlData["agentRegistry"]["agents"][number];

// Prompts offered in the launch modal's "start from a library prompt" picker:
// project-scoped templates (they operate on a single repo, which is exactly
// what a launch targets), most useful ones first.
const LAUNCH_PROMPT_OPTIONS = PROMPT_TEMPLATES.filter((t) => t.scope === "project").sort(
  (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)),
);

export function NewProjectModal({
  name,
  dir,
  gitUrl,
  error,
  creating,
  onNameChange,
  onDirChange,
  onGitUrlChange,
  onCreate,
  onClose,
}: {
  name: string;
  dir: string;
  gitUrl: string;
  error: string;
  creating: boolean;
  onNameChange: (value: string) => void;
  onDirChange: (value: string) => void;
  onGitUrlChange: (value: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} size="md">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-text-primary">New project</h3>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
          placeholder="Project name"
          aria-label="Project name"
          className="ui-input w-full"
        />
        <input
          value={dir}
          onChange={(e) => onDirChange(e.target.value)}
          placeholder="Local path — e.g. ~/dev/my-project"
          aria-label="Local path"
          className="ui-input w-full"
        />
        <input
          value={gitUrl}
          onChange={(e) => onGitUrlChange(e.target.value)}
          placeholder="Git URL — optional"
          className="ui-input w-full"
        />
      </div>
      {error && <p className="ui-error">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCreate}
          disabled={creating || !name.trim()}
          className="ui-btn-primary flex-1 gap-1.5"
        >
          {creating ? <Loader2 className="ui-spinner-sm" /> : <Plus className="h-3.5 w-3.5" />}
          {dir.trim() ? "Create & launch" : "Create"}
        </button>
        <button onClick={onClose} className="ui-btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function LaunchTabModal({
  tab,
  dir,
  agents,
  selectedAgentId,
  initialPrompt,
  launching,
  error,
  onAgentChange,
  onInitialPromptChange,
  onLaunch,
  onClose,
}: {
  tab: string;
  dir: string;
  agents: AgentEntry[];
  selectedAgentId: string;
  initialPrompt: string;
  launching: boolean;
  error: string;
  onAgentChange: (agentId: string) => void;
  onInitialPromptChange: (value: string) => void;
  onLaunch: () => void;
  onClose: () => void;
}) {
  const selected = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const hasPrompt = initialPrompt.trim().length > 0;

  return (
    <Modal onClose={onClose} size="md">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-text-primary">Launch development tab</h3>
          <p className="mt-1 text-sm text-text-tertiary">
            {tab} · {dir}
          </p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onAgentChange(agent.id)}
              disabled={!agent.available}
              className={selectedAgentId === agent.id ? "ui-chip-toggle-active" : "ui-chip-toggle"}
              title={
                agent.available
                  ? `${agent.label}`
                  : (agent.availabilityReason ?? `${agent.label} unavailable`)
              }
            >
              {agent.label}
            </button>
          ))}
        </div>

        {selected && !selected.available && (
          <p className="text-sm text-status-warning">
            {selected.availabilityReason ?? `${selected.label} is unavailable on this machine.`}
          </p>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-caps">
            Initial task <span className="font-normal normal-case text-text-muted">— optional</span>
          </label>
          <select
            value=""
            onChange={(e) => {
              const picked = LAUNCH_PROMPT_OPTIONS.find((t) => t.id === e.target.value);
              if (picked)
                onInitialPromptChange(picked.template.replaceAll("{{project_name}}", tab));
            }}
            className="ui-input ui-input-compact w-full"
            aria-label="Start from a library prompt"
          >
            <option value="">Start from a library prompt…</option>
            {LAUNCH_PROMPT_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon ? `${t.icon} ` : ""}
                {t.name}
              </option>
            ))}
          </select>
          <textarea
            value={initialPrompt}
            onChange={(e) => onInitialPromptChange(e.target.value)}
            placeholder="What should the agent do first? Injected automatically once it starts."
            rows={3}
            className="ui-input w-full resize-none"
          />
        </div>
      </div>

      {error && <p className="ui-error">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onLaunch}
          disabled={launching || !selected || !selected.available}
          className="ui-btn-primary flex-1 gap-1.5"
        >
          {launching ? <Loader2 className="ui-spinner-sm" /> : <Plus className="h-3.5 w-3.5" />}
          {hasPrompt ? "Launch & run" : "Launch"}
        </button>
        <button onClick={onClose} className="ui-btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
