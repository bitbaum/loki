"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { AGENT_LABELS, type AnyAgentId } from "@/lib/agent-labels";
import { Modal } from "@/components/ui/modal";
import { postJson } from "@/lib/api/fetch";
import { useClipboard } from "@/hooks/use-clipboard";
import { FEEDBACK_MEDIUM_MS } from "@/lib/constants/timings";
import {
  type Brief,
  type BootstrapResult,
  BRIEF_DEFAULTS,
  DescribeStep,
  ReviewStep,
  CreatingStep,
  DoneStep,
} from "./bootstrap-modal-steps";

type Step = "describe" | "review" | "creating" | "done";

export function BootstrapModal({
  agentId,
  agentModel,
  onClose,
}: {
  agentId: string;
  agentModel: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("describe");
  const [idea, setIdea] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [brief, setBrief] = useState<Brief>(BRIEF_DEFAULTS);
  const [db, setDb] = useState<"postgres" | "none">("none");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const { copied, copy } = useClipboard(FEEDBACK_MEDIUM_MS);

  async function generateBrief() {
    if (!idea.trim() || generating) return;
    setGenerating(true);
    setGenError("");
    try {
      const res = await postJson("/api/project/ai-brief", { description: idea.trim() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to generate brief");
      const g = body.brief;
      setBrief({
        name: g.name ?? "",
        tagline: g.tagline ?? "",
        targetUser: g.targetUser ?? "",
        coreProblem: g.coreProblem ?? "",
        coreFeatures:
          Array.isArray(g.coreFeatures) && g.coreFeatures.length > 0
            ? g.coreFeatures
            : ["", "", ""],
        stack: {
          frontend: g.stack?.frontend ?? "Next.js 15",
          backend: g.stack?.backend ?? "TypeScript",
          db: g.stack?.db ?? "PostgreSQL + Drizzle ORM",
        },
        monetization: g.monetization ?? "",
        launchStrategy: g.launchStrategy ?? "",
      });
      setStep("review");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  }

  async function createProject() {
    if (creating || !brief.name.trim()) return;
    setCreating(true);
    setCreateError("");
    setStep("creating");
    try {
      const res = await postJson("/api/project/bootstrap", {
        name: brief.name,
        tagline: brief.tagline || undefined,
        targetUser: brief.targetUser || undefined,
        coreProblem: brief.coreProblem || undefined,
        coreFeatures: brief.coreFeatures.filter(Boolean),
        stack: brief.stack,
        monetization: brief.monetization || undefined,
        launchStrategy: brief.launchStrategy || undefined,
        db,
        visibility,
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Bootstrap failed");
      setResult(body as BootstrapResult);
      setStep("done");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Bootstrap failed");
      setStep("review");
    } finally {
      setCreating(false);
    }
  }

  async function launchClaudeCode() {
    if (!result || launching) return;
    setLaunching(true);
    setLaunchError("");
    try {
      const res = await postJson("/api/agent/launch", {
        tab: result.tab,
        dir: result.dir,
        agent: agentId,
        model: agentModel || undefined,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Launch failed");
      onClose();
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  }

  function copyPrompt() {
    if (!result?.launchPrompt) return;
    copy(result.launchPrompt);
  }

  const STEP_LABELS: Record<Step, { title: string; sub: string }> = {
    describe: { title: "New project", sub: "Describe your idea — AI fills in the rest" },
    review: { title: "Review brief", sub: "Edit anything before creating" },
    creating: { title: "Creating…", sub: `Setting up ${brief.name}` },
    done: { title: "Ready to launch", sub: brief.name },
  };

  return (
    <Modal onClose={onClose} size="xl">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-text-primary">{STEP_LABELS[step].title}</h3>
          <p className="mt-0.5 text-sm text-text-tertiary">{STEP_LABELS[step].sub}</p>
        </div>
        <button onClick={onClose} className="shrink-0 text-text-muted hover:text-text-primary">
          <X className="h-4 w-4" />
        </button>
      </div>

      {step === "describe" && (
        <DescribeStep
          idea={idea}
          generating={generating}
          genError={genError}
          onIdeaChange={setIdea}
          onGenerate={generateBrief}
          onClose={onClose}
        />
      )}
      {step === "review" && (
        <ReviewStep
          brief={brief}
          setBrief={setBrief}
          db={db}
          setDb={setDb}
          visibility={visibility}
          setVisibility={setVisibility}
          createError={createError}
          creating={creating}
          onCreate={createProject}
          onBack={() => setStep("describe")}
        />
      )}
      {step === "creating" && <CreatingStep name={brief.name} />}
      {step === "done" && result && (
        <DoneStep
          result={result}
          launching={launching}
          launchError={launchError}
          copied={copied}
          onLaunch={launchClaudeCode}
          agentLabel={AGENT_LABELS[agentId as AnyAgentId] ?? agentId}
          onCopyPrompt={copyPrompt}
        />
      )}
    </Modal>
  );
}
