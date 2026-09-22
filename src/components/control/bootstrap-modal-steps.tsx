"use client";

import { Loader2, Sparkles, CheckCircle, XCircle, Copy, Rocket, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/config/brand";

export interface Brief {
  name: string;
  tagline: string;
  targetUser: string;
  coreProblem: string;
  coreFeatures: string[];
  stack: { frontend: string; backend: string; db: string };
  monetization: string;
  launchStrategy: string;
}

export interface BootstrapStepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface BootstrapResult {
  tab: string;
  dir: string;
  gitUrl: string;
  dbUrl: string | null;
  steps: BootstrapStepResult[];
  launchPrompt: string;
}

export const BRIEF_DEFAULTS: Brief = {
  name: "",
  tagline: "",
  targetUser: "",
  coreProblem: "",
  coreFeatures: ["", "", ""],
  stack: { frontend: "Next.js 15", backend: "TypeScript", db: "PostgreSQL + Drizzle ORM" },
  monetization: "",
  launchStrategy: "",
};

export function BriefField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="ui-kicker">{label}</p>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ui-input w-full"
        placeholder={placeholder}
      />
    </div>
  );
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  labelFn,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelFn?: (opt: T) => string;
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition-colors",
            value === opt
              ? "border-accent-primary bg-accent-muted text-text-primary"
              : "border-border-subtle text-text-secondary hover:text-text-primary",
          )}
        >
          {labelFn ? labelFn(opt) : opt}
        </button>
      ))}
    </div>
  );
}

export function DescribeStep({
  idea,
  generating,
  genError,
  onIdeaChange,
  onGenerate,
  onClose,
}: {
  idea: string;
  generating: boolean;
  genError: string;
  onIdeaChange: (v: string) => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <textarea
        autoFocus
        value={idea}
        onChange={(e) => onIdeaChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.metaKey && onGenerate()}
        rows={6}
        placeholder={
          "I'm building a tool that helps freelancers track invoices and get paid faster.\n" +
          "Target: solo devs and designers who forget to follow up.\n" +
          "Simple dashboard, automated reminders, Stripe payments…"
        }
        className="ui-input w-full resize-none leading-relaxed"
      />
      {genError && <p className="ui-error">{genError}</p>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onGenerate}
          disabled={!idea.trim() || generating}
          className="ui-btn-primary flex-1 gap-1.5"
        >
          {generating ? (
            <Loader2 className="ui-spinner-sm" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {generating ? "Generating brief… (~30s)" : "Generate brief →"}
        </button>
        <button onClick={onClose} className="ui-btn-secondary">
          Cancel
        </button>
      </div>
    </>
  );
}

export function ReviewStep({
  brief,
  setBrief,
  db,
  setDb,
  visibility,
  setVisibility,
  createError,
  creating,
  onCreate,
  onBack,
}: {
  brief: Brief;
  setBrief: React.Dispatch<React.SetStateAction<Brief>>;
  db: "postgres" | "none";
  setDb: (v: "postgres" | "none") => void;
  visibility: "private" | "public";
  setVisibility: (v: "private" | "public") => void;
  createError: string;
  creating: boolean;
  onCreate: () => void;
  onBack: () => void;
}) {
  const updateFeature = (i: number, val: string) => {
    const next = [...brief.coreFeatures];
    next[i] = val;
    setBrief((b) => ({ ...b, coreFeatures: next }));
  };

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <BriefField
            label="Project name"
            value={brief.name}
            onChange={(v) => setBrief((b) => ({ ...b, name: v }))}
            placeholder="my-project"
            autoFocus
          />
          <BriefField
            label="Tagline"
            value={brief.tagline}
            onChange={(v) => setBrief((b) => ({ ...b, tagline: v }))}
            placeholder="One sentence description"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <BriefField
            label="For"
            value={brief.targetUser}
            onChange={(v) => setBrief((b) => ({ ...b, targetUser: v }))}
            placeholder="Who is this for?"
          />
          <BriefField
            label="Problem"
            value={brief.coreProblem}
            onChange={(v) => setBrief((b) => ({ ...b, coreProblem: v }))}
            placeholder="Pain point in one sentence"
          />
        </div>
        <div className="space-y-1.5">
          <p className="ui-kicker">Core MVP features</p>
          <div className="space-y-2">
            {brief.coreFeatures.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-center text-xs font-bold text-accent-text">
                  {i + 1}
                </span>
                <input
                  value={f}
                  onChange={(e) => updateFeature(i, e.target.value)}
                  className="ui-input flex-1"
                  placeholder={`Feature ${i + 1}`}
                />
              </div>
            ))}
            {brief.coreFeatures.length < 7 && (
              <button
                type="button"
                onClick={() => setBrief((b) => ({ ...b, coreFeatures: [...b.coreFeatures, ""] }))}
                className="ml-6 ui-link-muted"
              >
                + Add feature
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="ui-kicker">Stack</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["frontend", "backend", "db"] as const).map((key) => (
              <input
                key={key}
                value={brief.stack[key]}
                onChange={(e) =>
                  setBrief((b) => ({ ...b, stack: { ...b.stack, [key]: e.target.value } }))
                }
                className="ui-input"
                placeholder={key}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <BriefField
            label="Monetization"
            value={brief.monetization}
            onChange={(v) => setBrief((b) => ({ ...b, monetization: v }))}
            placeholder="How it makes money"
          />
          <BriefField
            label="Launch strategy"
            value={brief.launchStrategy}
            onChange={(v) => setBrief((b) => ({ ...b, launchStrategy: v }))}
            placeholder="First channel or approach"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="ui-kicker">Database</p>
            <ToggleGroup
              options={["postgres", "none"] as const}
              value={db}
              onChange={setDb}
              labelFn={(opt) => (opt === "postgres" ? "Postgres (self-hosted)" : "None")}
            />
          </div>
          <div className="space-y-1.5">
            <p className="ui-kicker">Visibility</p>
            <ToggleGroup
              options={["private", "public"] as const}
              value={visibility}
              onChange={setVisibility}
            />
          </div>
        </div>
      </div>
      {createError && <p className="ui-error">{createError}</p>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCreate}
          disabled={!brief.name.trim() || creating}
          className="ui-btn-primary flex-1 gap-1.5"
        >
          <Rocket className="h-3.5 w-3.5" />
          Create everything →
        </button>
        <button onClick={onBack} className="ui-btn-secondary gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>
    </>
  );
}

export function CreatingStep({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <Loader2 className="h-8 w-8 animate-spin text-accent-text" />
      <div className="text-center">
        <p className="font-medium text-text-primary">{name}</p>
        <p className="mt-1 text-sm text-text-tertiary">
          GitHub repo · git init · {APP_NAME} registration
        </p>
      </div>
    </div>
  );
}

export function DoneStep({
  result,
  launching,
  launchError,
  copied,
  onLaunch,
  agentLabel,
  onCopyPrompt,
}: {
  result: BootstrapResult;
  launching: boolean;
  launchError: string;
  copied: boolean;
  onLaunch: () => void;
  agentLabel: string;
  onCopyPrompt: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        {result.steps.map((s) => (
          <div key={s.step} className="flex items-start gap-3">
            {s.ok ? (
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-positive" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">{s.step}</p>
              {s.detail && (
                <p className="mt-0.5 truncate text-xs text-text-tertiary" title={s.detail}>
                  {s.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border-subtle bg-surface-overlay px-4 py-3 space-y-1">
        {result.gitUrl && (
          <p className="truncate text-sm text-text-secondary" title={result.gitUrl}>
            {result.gitUrl}
          </p>
        )}
        {result.dbUrl && <p className="text-xs text-status-positive">Database connected</p>}
        <p className="truncate text-xs text-text-muted" title={result.dir}>
          {result.dir}
        </p>
      </div>
      {launchError && <p className="ui-error">{launchError}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={onLaunch} disabled={launching} className="ui-btn-primary flex-1 gap-1.5">
          {launching ? <Loader2 className="ui-spinner-sm" /> : <Rocket className="h-3.5 w-3.5" />}
          Launch {agentLabel} →
        </button>
        <button onClick={onCopyPrompt} className="ui-btn-secondary gap-1.5">
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied!" : "Copy prompt"}
        </button>
      </div>
    </>
  );
}
