"use client";

// "Start a new project from scratch" without local runtime.
// Creates a brand new GitHub repo + Loki project record in one shot.
// After, the user can `git clone` it on any machine — no Fleet Runner needed.
//
// Companion to BootstrapModal which does the full local stack scaffold but
// only works when the local runner is running.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, GitBranch, Check, Copy } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { TEMPLATES, type TemplateId } from "@/lib/project-templates";
import { setDraft } from "@/lib/draft-storage";

type CreateResponse = {
  ok: boolean;
  project?: { id: string; name: string };
  repo?: {
    name: string;
    full_name: string;
    gitUrl: string;
    sshUrl: string;
    cloneUrl: string;
    private: boolean;
  };
  template?: TemplateId;
  templateSeeded?: boolean;
  infra?: string[];
  firstTask?: string;
  cloneCmd?: string;
  cloneHttpsCmd?: string;
  error?: string;
  detail?: string;
  hasGithub?: boolean;
};

/**
 * ARRIVING FROM SOMEWHERE ELSE.
 *
 * Loki is the execution plane of an entity; OrangeCat is its economy. Someone
 * who has just described what they want to build, over there, should not have
 * to type it again over here — retyping is where a handoff is lost.
 *
 * So this page accepts the brief in the URL:
 *
 *   /control/new-from-scratch?name=<repo>&brief=<what to build>
 *
 * Prefill only. Nothing is created, nothing is sent, and every field stays
 * editable — an inbound link may not act on someone's behalf, it may only save
 * them the typing. OrangeCat's Cat has had the mirror of this for a while
 * (`/dashboard/cat?q=`), which is what makes the round trip possible.
 *
 * Capped because a URL is attacker-controlled: a caller cannot use this to
 * paste a novel into the form.
 */
const MAX_PREFILL = { name: 100, brief: 2000 };

function NewFromScratchForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState(() =>
    (params?.get("name") ?? "").trim().slice(0, MAX_PREFILL.name),
  );
  const [description, setDescription] = useState(() =>
    (params?.get("brief") ?? "").trim().slice(0, MAX_PREFILL.brief),
  );
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [template, setTemplate] = useState<TemplateId>("bare");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"ssh" | "https" | "task" | null>(null);

  function startBuilding(firstTask: string, projectName: string) {
    // Prime the project's dispatch box via the same per-tab draft store the
    // ProjectCard reads on mount (getDraft) — so when the project appears in
    // Control (once a runner has cloned it), its box is already filled with the
    // setup task. One less copy-paste; zero new plumbing.
    setDraft(projectName, firstTask);
    router.push("/control");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/projects/create-with-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          visibility,
          init_readme: true,
          template,
        }),
      });
      const body = (await res.json()) as CreateResponse;
      if (!res.ok || !body.ok) {
        const msg = body.error
          ? body.detail
            ? `${body.error} — ${body.detail}`
            : body.error
          : `Failed (HTTP ${res.status})`;
        setError(msg);
        if (body.hasGithub === false) {
          // No GitHub linked — surface a path to connect.
          setError(`${msg} Go to /control/import to connect GitHub first.`);
        }
        setSubmitting(false);
        return;
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSubmitting(false);
    }
  }

  async function copy(text: string, kind: "ssh" | "https" | "task") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  // ── Result view ─────────────────────────────────────────────────────────

  if (result?.ok && result.repo && result.project) {
    const seededLabel =
      result.template && result.template !== "bare" && result.templateSeeded
        ? TEMPLATES[result.template].label
        : null;
    const infra = result.infra ?? [];
    const firstTask = result.firstTask ?? "";
    return (
      <PageLayout title="Project ready" back={{ href: "/control", label: "Back to Control" }}>
        <div className="max-w-2xl space-y-6">
          <div className="ui-card-shell space-y-5 p-5 sm:p-6">
            {/* What Loki already did, automatically */}
            <div>
              <h2 className="ui-page-subtitle">{result.project.name}</h2>
              <p className="text-sm text-text-muted mt-1">Loki set these up for you:</p>
              <ul className="mt-3 space-y-1.5">
                <li className="flex items-start gap-2 text-sm text-text-secondary">
                  <Check className="h-4 w-4 mt-0.5 shrink-0 text-status-positive" />
                  <span>
                    <GitBranch className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                    {result.repo.private ? "Private" : "Public"} GitHub repo{" "}
                    <a
                      href={result.repo.gitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-text underline break-all"
                    >
                      {result.repo.full_name}
                    </a>
                  </span>
                </li>
                {seededLabel && (
                  <li className="flex items-start gap-2 text-sm text-text-secondary">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-status-positive" />
                    <span>
                      <strong>{seededLabel}</strong> starter scaffolded into the repo
                    </span>
                  </li>
                )}
                {result.template && result.template !== "bare" && !result.templateSeeded && (
                  <li className="flex items-start gap-2 text-sm text-status-warning">
                    <span>
                      ⚠ Starter seeding failed — the repo has just a README; the agent will scaffold
                      the stack instead.
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2 text-sm text-text-secondary">
                  <Check className="h-4 w-4 mt-0.5 shrink-0 text-status-positive" />
                  <span>Registered as a Loki project (it&apos;s in Control now)</span>
                </li>
              </ul>
            </div>

            {/* The bridge: start building it on autopilot */}
            <div className="pt-4 border-t border-border-subtle space-y-3">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  Now build it on autopilot
                </div>
                <p className="text-sm text-text-muted mt-1">
                  Dispatch the first task and an agent takes it from scaffold to running — setting
                  up
                  {infra.length > 0 ? " " : " everything it needs"}
                  {infra.length > 0 && (
                    <span className="inline-flex flex-wrap gap-1.5 align-middle ml-1">
                      {infra.map((i) => (
                        <span key={i} className="ui-tag text-xs">
                          {i}
                        </span>
                      ))}
                    </span>
                  )}
                  .
                </p>
              </div>

              {firstTask && (
                <div className="relative">
                  <div className="text-xs text-text-tertiary mb-1">The agent&apos;s first task</div>
                  <pre className="ui-card-shell p-3 pr-10 overflow-x-auto whitespace-pre-wrap text-xs text-text-secondary">
                    <code>{firstTask}</code>
                  </pre>
                  <button
                    type="button"
                    onClick={() => copy(firstTask, "task")}
                    className="absolute top-7 right-2 ui-btn-icon"
                    title="Copy first task"
                  >
                    {copied === "task" ? (
                      <Check className="h-3.5 w-3.5 text-status-positive" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              )}

              <div className="ui-card-shell p-3 text-xs text-text-muted">
                The one thing Loki can&apos;t do for you: run code on your machine.{" "}
                <Link href="/download" className="text-accent-text underline">
                  Connect Fleet Runner
                </Link>{" "}
                on the machine you&apos;ll build from — it clones the repo and runs this task
                automatically. No runner yet? The task queues until one connects.
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setName("");
                    setDescription("");
                  }}
                  className="ui-btn-ghost"
                >
                  Create another
                </button>
                <button
                  type="button"
                  onClick={() => startBuilding(firstTask, result.project!.name)}
                  className="ui-btn-primary"
                >
                  Open in Control →
                </button>
              </div>
            </div>

            {/* Escape hatch for local-first builders */}
            <details className="text-xs text-text-tertiary pt-2 border-t border-border-subtle">
              <summary className="cursor-pointer">Prefer to set it up by hand?</summary>
              <div className="mt-3 space-y-3">
                <div className="relative">
                  <div className="text-text-muted mb-1">Clone it yourself</div>
                  <pre className="ui-card-shell p-3 pr-10 overflow-x-auto text-text-secondary">
                    <code>{result.cloneCmd}</code>
                  </pre>
                  <button
                    type="button"
                    onClick={() => copy(result.cloneCmd ?? "", "ssh")}
                    className="absolute top-7 right-2 ui-btn-icon"
                  >
                    {copied === "ssh" ? (
                      <Check className="h-3.5 w-3.5 text-status-positive" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <div className="relative mt-2">
                    <pre className="ui-card-shell p-3 pr-10 overflow-x-auto text-text-secondary">
                      <code>{result.cloneHttpsCmd}</code>
                    </pre>
                    <button
                      type="button"
                      onClick={() => copy(result.cloneHttpsCmd ?? "", "https")}
                      className="absolute top-2 right-2 ui-btn-icon"
                    >
                      {copied === "https" ? (
                        <Check className="h-3.5 w-3.5 text-status-positive" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`cursor://file/${encodeURIComponent("~/dev/" + result.repo.name)}`}
                    className="ui-btn-secondary text-xs"
                  >
                    Open in Cursor
                  </a>
                  <a
                    href={`vscode://file/${encodeURIComponent("~/dev/" + result.repo.name)}`}
                    className="ui-btn-secondary text-xs"
                  >
                    Open in VS Code
                  </a>
                </div>
              </div>
            </details>
          </div>
        </div>
      </PageLayout>
    );
  }

  // ── Form view ───────────────────────────────────────────────────────────

  return (
    <PageLayout
      title="Start a new project"
      subtitle="Name it and say what you want to build. Loki creates the GitHub repo and — unless you choose otherwise below — picks the best stack and sets it up for you. No technical decisions required."
      back={{ href: "/control", label: "Back to Control" }}
    >
      <div className="max-w-2xl space-y-6">
        {/* The card carried an h2 reading "Start a new project" directly under
            the h1 of the same words, then repeated the intro paragraph. Both
            now live in the page header, where they are said once. */}
        <div className="ui-card-shell space-y-5 p-5 sm:p-6">
          {error && <div className="ui-error p-3 rounded-md text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Project name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="catsitting-marketplace"
                autoFocus
                required
                maxLength={80}
                className="ui-input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                What do you want to build?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A peer-to-peer marketplace where cat owners find trusted sitters nearby."
                maxLength={300}
                rows={3}
                className="ui-input w-full resize-y"
              />
              <p className="text-xs text-text-tertiary mt-1">
                Plain English. The agent uses this to choose the stack and build the first version.
              </p>
            </div>

            {/* Advanced — collapsed by default so a non-technical user never has to
                choose a stack. Defaults: private repo + agent picks the stack. */}
            <details className="ui-card-shell px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-text-secondary">
                Advanced — choose the stack &amp; visibility yourself
              </summary>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-text-primary mb-1">Visibility</div>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-2 cursor-pointer flex-1 ui-card-shell p-3">
                      <input
                        type="radio"
                        name="visibility"
                        value="private"
                        checked={visibility === "private"}
                        onChange={() => setVisibility("private")}
                      />
                      <div>
                        <div className="text-sm font-medium">Private</div>
                        <div className="text-xs text-text-muted">Only you can see this repo.</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer flex-1 ui-card-shell p-3">
                      <input
                        type="radio"
                        name="visibility"
                        value="public"
                        checked={visibility === "public"}
                        onChange={() => setVisibility("public")}
                      />
                      <div>
                        <div className="text-sm font-medium">Public</div>
                        <div className="text-xs text-text-muted">Anyone can find and read it.</div>
                      </div>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-text-primary mb-1">Starter</div>
                  <p className="text-xs text-text-tertiary mb-2">
                    Leave on <strong>Empty</strong> and the agent picks the stack that fits your
                    idea.
                  </p>
                  <div className="space-y-2">
                    {Object.values(TEMPLATES).map((t) => (
                      <label
                        key={t.id}
                        className="flex items-start gap-2 cursor-pointer ui-card-shell p-3"
                      >
                        <input
                          type="radio"
                          name="template"
                          value={t.id}
                          checked={template === t.id}
                          onChange={() => setTemplate(t.id)}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm font-medium">{t.label}</div>
                          <div className="text-xs text-text-muted">{t.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </details>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
              <Link href="/control" className="ui-btn-ghost">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>Create project →</>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </PageLayout>
  );
}

/**
 * `useSearchParams` requires a Suspense boundary or the build fails on this
 * route. The fallback is deliberately nothing: the form appears a tick later,
 * and a skeleton that flashes for one frame is worse than no skeleton.
 */
export default function NewFromScratchPage() {
  return (
    <Suspense fallback={null}>
      <NewFromScratchForm />
    </Suspense>
  );
}
