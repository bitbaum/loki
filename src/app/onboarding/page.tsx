"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { GitBranch } from "lucide-react";
import { normalizeUsername } from "@/lib/username";
import { postJson, patchJson, throwApiError, getJson } from "@/lib/api/fetch";
import { normalizeSiteUrl } from "@/lib/site-url";
import { ROUTES } from "@/config/auth";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { APP_DOMAIN } from "@/config/brand";
import {
  AuthShell,
  AuthCard,
  AuthField,
  AuthInput,
  AuthSubmitButton,
  AuthHeading,
  AuthProgressBar,
  AuthPrefixField,
  AuthLoadingCenter,
} from "@/components/auth/AuthShell";
import { ConnectMachineStep } from "@/components/onboarding/ConnectMachineStep";
import { RepoPicker } from "@/components/onboarding/RepoPicker";
import type { GitHubRepo } from "@/app/api/github/repos/route";

type OnboardingStep = "username" | "project" | "site" | "connect";

/** What the site step shows: the snippet, and the way onto the site. */
type SiteSetup = {
  entityProjectId: string;
  snippet: string;
  openSiteUrl: string | null;
  canInstall: boolean;
};

type OnboardingBootstrap = {
  complete?: boolean;
  suggestedUsername?: string;
  isTeamInvitee?: boolean;
  isReturningUser?: boolean;
  projectCount?: number;
  needsSessionRefresh?: boolean;
};

function stepIndex(step: OnboardingStep, withSite: boolean): number {
  if (step === "username") return 0;
  if (step === "project") return 1;
  if (step === "site") return 2;
  return withSite ? 3 : 2;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { update } = useSession();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [step, setStep] = useState<OnboardingStep>("username");
  const [isTeamInvitee, setIsTeamInvitee] = useState(false);
  const [username, setUsername] = useState("");
  const [projectName, setProjectName] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [site, setSite] = useState<SiteSetup | null>(null);
  const [installNote, setInstallNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Hold the latest update() callback in a ref so the bootstrap effect can
  // call it without depending on its identity. Without this, every call to
  // update() triggers a session re-render → new update() reference → effect
  // re-fires → infinite loop of /api/onboarding pending requests (observed
  // 2026-06-05 during dogfood; 200+ requests in flight, all stuck pending).
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // Sync JWT from DB (fixes migrated accounts with stale cookies).
        await updateRef.current();
        const data = await getJson<OnboardingBootstrap>("/api/onboarding");
        if (cancelled) return;

        if (data.complete && (data.projectCount ?? 0) > 0) {
          if (data.needsSessionRefresh) await updateRef.current();
          router.replace(ROUTES.APP_HOME);
          return;
        }
        if (data.complete && (data.projectCount ?? 0) === 0) {
          if (data.needsSessionRefresh) await updateRef.current();
          setStep(data.isTeamInvitee ? "connect" : "project");
          setIsTeamInvitee(data.isTeamInvitee ?? false);
          return;
        }

        if (data.isReturningUser) {
          const res = await postJson("/api/onboarding", {});
          if (res.ok) {
            await updateRef.current();
            router.replace(ROUTES.APP_HOME);
            return;
          }
          // Heal couldn't auto-finish (typically: no valid username was
          // suggestable — taken, or unsuggestable from name/email). Fall
          // through to the normal step so the user can pick one explicitly,
          // and surface the reason instead of bouncing back here forever.
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Pick a username to finish setup.");
        }

        if (data.suggestedUsername) {
          setUsername((prev) => prev || data.suggestedUsername || "");
        }
        if (data.isTeamInvitee) {
          setIsTeamInvitee(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load onboarding");
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps: this is one-shot bootstrap. router is stable
    // from useRouter(); update() is held in a ref above. Adding either here
    // would re-fire the effect on every session change — the bug this fix
    // closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishOnboarding() {
    setSaving(true);
    setError("");
    try {
      const res = await postJson("/api/onboarding", {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to complete onboarding");
      }
      await update();
      // Land on Control, not /today: the onboarding's whole arc is "connect a
      // builder to dispatch agents", so the next step a new builder wants is the
      // dispatch surface — and the finish button literally says "Go to Control".
      // Someone who gave their website lands on that project instead: its
      // page has the live link with Loki on it, the widget's status, and
      // the first change waiting to be said.
      router.push(site ? `/projects/${site.entityProjectId}` : "/control");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function saveUsername() {
    if (!username.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await patchJson("/api/me", { username: normalizeUsername(username) });
      if (!res.ok) await throwApiError(res, "Failed to save username");
      await update();

      const status = await getJson<OnboardingBootstrap>("/api/onboarding");
      const teamInvitee = status.isTeamInvitee ?? false;
      setIsTeamInvitee(teamInvitee);
      setStep(teamInvitee ? "connect" : "project");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function handleRepoSelect(repo: GitHubRepo) {
    setProjectName(repo.name);
    setGitUrl(repo.html_url);
    setShowManual(false);
  }

  async function saveProject(skip = false) {
    setSaving(true);
    setError("");
    try {
      if (!skip && projectName.trim()) {
        const web = normalizeSiteUrl(liveUrl);
        if (liveUrl.trim() && !web) throw new Error("That does not look like a website address.");
        const res = await postJson("/api/user-projects", {
          name: projectName.trim(),
          dirPath: dirPath.trim() || undefined,
          gitUrl: gitUrl.trim() || undefined,
          liveUrl: web ?? undefined,
        });
        // This used to ignore the answer: a 409 or a 403 advanced the step
        // and the person found out later that no project existed.
        if (!res.ok) await throwApiError(res, "Could not add the project");
        const project = (await res.json()) as { entityProjectId?: string | null };
        // A website means Loki can be ON it: mint the widget token now (its
        // origin is the site's, since the live URL is already set) and show
        // the one line that puts Loki there.
        if (web && project.entityProjectId) {
          const tok = await postJson(`/api/projects/${project.entityProjectId}/widget-token`, {});
          if (tok.ok) {
            const body = (await tok.json()) as {
              token?: { snippet?: string } | null;
              openSiteUrl?: string | null;
            };
            if (body.token?.snippet) {
              setSite({
                entityProjectId: project.entityProjectId,
                snippet: body.token.snippet,
                openSiteUrl: body.openSiteUrl ?? null,
                canInstall: Boolean(gitUrl.trim() || dirPath.trim()),
              });
              setStep("site");
              return;
            }
          }
        }
      }
      setStep("connect");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function copySnippet() {
    if (!site) return;
    try {
      await navigator.clipboard.writeText(site.snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the line and copy it yourself.");
    }
  }

  /** The agent adds the one line to the repo; the answer says what happened. */
  async function installWithAgent() {
    if (!site) return;
    setSaving(true);
    setInstallNote("");
    setError("");
    try {
      const res = await postJson(`/api/projects/${site.entityProjectId}/widget-token/install`, {
        mode: "install",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
      if (!res.ok) {
        setInstallNote([body.error, body.hint].filter(Boolean).join(" "));
        return;
      }
      setInstallNote(
        "An agent is adding it now. When it is on the site, open it and Loki is in the corner.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (bootstrapping) {
    return (
      <AuthShell>
        <AuthLoadingCenter />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthProgressBar activeStep={stepIndex(step, site !== null)} steps={site ? 4 : 3} />

      {step === "username" ? (
        <>
          <AuthHeading
            title="Choose your handle"
            description={`Your public profile: ${APP_DOMAIN}/u/you`}
          />
          <AuthCard>
            <AuthField label="Username" htmlFor="onboarding-username">
              <AuthPrefixField
                id="onboarding-username"
                prefix={`${APP_DOMAIN}/u/`}
                value={username}
                onChange={setUsername}
                onEnter={saveUsername}
                placeholder="yourname"
              />
            </AuthField>
            {error && <p className="ui-error">{error}</p>}
            <AuthSubmitButton
              loading={saving}
              disabled={!username.trim()}
              label="Continue →"
              loadingLabel="Saving…"
              onClick={saveUsername}
            />
          </AuthCard>
        </>
      ) : step === "project" ? (
        <>
          <AuthHeading
            title="Add your first project"
            description="What you'll launch agents on. Add more any time."
          />
          <AuthCard>
            <RepoPicker onSelect={handleRepoSelect} />

            {projectName && !showManual ? (
              <div className="space-y-3">
                <div className="ui-auth-confirmation-row">
                  <GitBranch className="h-4 w-4 ui-auth-icon-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="ui-auth-repo-name">{projectName}</p>
                    {gitUrl && <p className="ui-auth-repo-desc">{gitUrl}</p>}
                  </div>
                </div>
                {/* Local path even for a picked repo: a Fleet Runner on your own
                    machine dispatches INTO this directory, so without it a local
                    dispatch has nowhere to run. Optional — hosted runs clone the
                    gitUrl instead, and it's editable later on the project. */}
                <AuthField label="Local path on your machine (optional)">
                  <AuthInput
                    value={dirPath}
                    onChange={(e) => setDirPath(e.target.value)}
                    placeholder="/home/you/my-app"
                  />
                </AuthField>
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="ui-auth-muted-link"
                >
                  Enter details manually instead
                </button>
              </div>
            ) : showManual || !projectName ? (
              <div className="space-y-3">
                <AuthField label="Project name">
                  <AuthInput
                    autoFocus={showManual}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. my-app"
                  />
                </AuthField>
                <AuthField label="Local path (optional)">
                  <AuthInput
                    value={dirPath}
                    onChange={(e) => setDirPath(e.target.value)}
                    placeholder="/home/you/my-app"
                  />
                </AuthField>
                <AuthField label="GitHub URL (optional)">
                  <AuthInput
                    value={gitUrl}
                    onChange={(e) => setGitUrl(e.target.value)}
                    placeholder="https://github.com/you/my-app"
                  />
                </AuthField>
              </div>
            ) : null}

            {/* The website, for a project that is already online. It is what
                makes the next step possible: Loki on that site, watching, and
                the first change said from there — the whole product, from a
                phone, on day one. Shown for a picked repo and for manual entry
                alike; a project that is not online yet just leaves it empty. */}
            {(projectName || showManual) && (
              <AuthField label="Your website (optional)" htmlFor="onboarding-live-url">
                <AuthInput
                  id="onboarding-live-url"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  placeholder="yoursite.com"
                  inputMode="url"
                  autoComplete="url"
                />
                <p className="ui-auth-hint">
                  If it is online already, Loki can be on it: say what to change from the site
                  itself, and it gets built.
                </p>
              </AuthField>
            )}

            {error && <p className="ui-error">{error}</p>}

            <div className="ui-auth-row-actions">
              <button
                type="button"
                onClick={() => saveProject(true)}
                disabled={saving}
                className="ui-auth-secondary-btn flex-1"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={() => saveProject(false)}
                disabled={saving || !projectName.trim()}
                className="ui-auth-submit-btn flex-1"
              >
                {saving ? "Saving…" : "Continue →"}
              </button>
            </div>
          </AuthCard>
        </>
      ) : step === "site" && site ? (
        <>
          <AuthHeading
            title="Put Loki on your site"
            description="One line in your site's HTML. From then on, open your site and Loki is in the corner: say what to change there, and it gets built."
          />
          <AuthCard>
            <div className="space-y-3">
              <code className="ui-auth-snippet block select-all break-all">{site.snippet}</code>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={copySnippet} className="ui-auth-secondary-btn">
                  {copied ? "Copied" : "Copy the line"}
                </button>
                {site.canInstall && (
                  <button
                    type="button"
                    onClick={installWithAgent}
                    disabled={saving}
                    className="ui-auth-secondary-btn"
                  >
                    {saving ? "Sending…" : "Let an agent add it"}
                  </button>
                )}
              </div>
              {installNote && <p className="ui-auth-hint">{installNote}</p>}
              <p className="ui-auth-hint">
                Paste it before <code>&lt;/body&gt;</code> (or in <code>&lt;head&gt;</code>). It
                shows nothing to visitors but a small button; to you it is Loki.
              </p>
            </div>

            {error && <p className="ui-error">{error}</p>}

            <div className="ui-auth-row-actions">
              {site.openSiteUrl && (
                <a
                  href={site.openSiteUrl}
                  target="_blank"
                  rel="noopener"
                  className="ui-auth-secondary-btn flex-1 text-center"
                >
                  Open your site with Loki →
                </a>
              )}
              <button
                type="button"
                onClick={() => setStep("connect")}
                disabled={saving}
                className="ui-auth-submit-btn flex-1"
              >
                Continue →
              </button>
            </div>
          </AuthCard>
        </>
      ) : (
        <>
          <AuthHeading
            title={EXECUTOR_COPY.onboarding.stepTitle}
            description={
              isTeamInvitee
                ? EXECUTOR_COPY.onboarding.stepDescriptionTeam
                : EXECUTOR_COPY.onboarding.stepDescription
            }
          />
          <AuthCard>
            <ConnectMachineStep
              saving={saving}
              onComplete={finishOnboarding}
              onSkip={finishOnboarding}
            />
            {error && <p className="ui-error mt-3">{error}</p>}
          </AuthCard>
        </>
      )}
    </AuthShell>
  );
}
