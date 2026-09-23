"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, ExternalLink, Smartphone } from "lucide-react";
import { DESKTOP_DOWNLOAD, type DesktopDownloadPlatform } from "@/config/marketing-content";
import { FEEDBACK_MEDIUM_MS } from "@/lib/constants/timings";
import { useClipboard } from "@/hooks/use-clipboard";
import { APP_NAME, APP_URL } from "@/config/brand";
import { ROUTES } from "@/config/auth";

type PlatformId = DesktopDownloadPlatform["id"];

/** True on phones and tablets. Checked BEFORE the desktop OS sniffing below,
 *  because that sniffing gets mobile catastrophically wrong: an Android UA
 *  contains "linux" (so a phone was offered an 80 MB .deb) and an iPhone UA
 *  contains "like Mac OS X" (so an iPhone was offered an Apple Silicon .dmg).
 *  Neither device can open either file. */
function isHandheld(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Safari UA; the touch-point count is what
  // still gives it away.
  if (/iPad/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

function detectPlatformId(): PlatformId {
  if (typeof navigator === "undefined") return DESKTOP_DOWNLOAD.platforms[0].id;
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() || "";
  if (platform.includes("win") || ua.includes("windows")) return "win";
  if (ua.includes("android")) return "linux";
  if (platform.includes("mac") || ua.includes("mac")) return "mac";
  if (platform.includes("linux") || ua.includes("linux")) return "linux";
  return DESKTOP_DOWNLOAD.platforms[0].id;
}

type Detected = { platformId: PlatformId; handheld: boolean };

function subscribePlatform(onStoreChange: () => void) {
  const timer = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timer);
}

let clientDetected: Detected | null = null;
function getClientDetected(): Detected {
  // Cached so useSyncExternalStore sees a stable reference; recomputing built
  // a new object on every render and looped.
  clientDetected ??= { platformId: detectPlatformId(), handheld: isHandheld() };
  return clientDetected;
}

const SERVER_DETECTED: Detected = {
  // Server snapshot: pick the one that's actually ready so non-interactive
  // crawlers and the initial paint surface a real link, not a "coming soon"
  // panel that depends on the user's UA.
  platformId:
    DESKTOP_DOWNLOAD.platforms.find((p) => p.status === "ready")?.id ??
    DESKTOP_DOWNLOAD.platforms[0].id,
  handheld: false,
};

function getServerDetected(): Detected {
  return SERVER_DETECTED;
}

export function DesktopDownload() {
  const detected = useSyncExternalStore(subscribePlatform, getClientDetected, getServerDetected);
  const [selectedPlatformId, setSelectedPlatformId] = useState<PlatformId | null>(null);
  // A handheld visitor gets the handoff panel instead of install instructions
  // they cannot follow — until they ask for them explicitly.
  const [installShown, setInstallShown] = useState(false);
  const showInstall = !detected.handheld || installShown;
  const activePlatformId = selectedPlatformId ?? detected.platformId;
  // Typed through the union contract, not the current data: with every
  // platform shipping today the inferred literal is just "ready", which would
  // make the coming-soon branch unreachable and delete a UI state we still
  // need the moment a new platform is announced.
  const platforms: DesktopDownloadPlatform[] = DESKTOP_DOWNLOAD.platforms;
  const active = platforms.find((platform) => platform.id === activePlatformId) ?? platforms[0];
  const [showDeveloper, setShowDeveloper] = useState(false);

  return (
    <div className="ui-public-download">
      <div className="mx-auto max-w-[960px] px-6">
        <div className="text-center mb-12">
          <div className="ui-public-download-eyebrow">{DESKTOP_DOWNLOAD.hero.eyebrow}</div>
          <h2 className="ui-public-download-title">{DESKTOP_DOWNLOAD.hero.title}</h2>
          <p className="ui-public-download-lede">{DESKTOP_DOWNLOAD.hero.lede}</p>
        </div>

        {/* Web vs desktop — answers "do I need this?" before any download CTA */}
        <div className="ui-public-download-compare">
          <div className="ui-public-download-compare-card">
            <div className="ui-public-download-compare-label">
              {DESKTOP_DOWNLOAD.comparison.web.label}
            </div>
            <div className="ui-public-download-compare-tagline">
              {DESKTOP_DOWNLOAD.comparison.web.tagline}
            </div>
            <ul className="ui-public-download-compare-list">
              {DESKTOP_DOWNLOAD.comparison.web.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="ui-public-download-compare-card ui-public-download-compare-card-emphasis">
            <div className="ui-public-download-compare-label">
              {DESKTOP_DOWNLOAD.comparison.desktop.label}
            </div>
            <div className="ui-public-download-compare-tagline">
              {DESKTOP_DOWNLOAD.comparison.desktop.tagline}
            </div>
            <ul className="ui-public-download-compare-list">
              {DESKTOP_DOWNLOAD.comparison.desktop.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="ui-public-download-compare-note">{DESKTOP_DOWNLOAD.comparison.note}</p>

        {detected.handheld && <HandheldHandoff />}

        {!showInstall && (
          <button
            type="button"
            onClick={() => setInstallShown(true)}
            className="ui-public-download-reveal"
          >
            Show the desktop downloads anyway
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        )}

        {showInstall && (
          <>
            {/* Platform switcher */}
            <div className="ui-public-download-platform-bar">
              {DESKTOP_DOWNLOAD.platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlatformId(p.id)}
                  className={`ui-public-download-platform ${active.id === p.id ? "ui-public-download-platform-active" : "ui-public-download-platform-idle"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {active.status === "ready" ? (
              <ReadyPlatformPanel platform={active} />
            ) : (
              <ComingSoonPanel platform={active} />
            )}
          </>
        )}

        {/* 3-step "what happens next" — only relevant once a CTA is in view */}
        <div className="ui-public-download-steps">
          <div className="ui-public-download-steps-heading">After install</div>
          <div className="ui-public-download-steps-grid">
            {DESKTOP_DOWNLOAD.setupSteps.map((step) => (
              <div key={step.number} className="ui-public-download-step">
                <div className="ui-public-download-step-num">{step.number}</div>
                <div className="ui-public-download-step-title">{step.title}</div>
                <p className="ui-public-download-step-body">{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* What it uses on your computer — plain-language prereqs */}
        <div className="ui-public-download-prereqs">
          <div className="ui-public-download-prereqs-title">
            {DESKTOP_DOWNLOAD.prerequisites.title}
          </div>
          <p className="ui-public-download-prereqs-desc">
            {DESKTOP_DOWNLOAD.prerequisites.description}
          </p>
          <div className="ui-public-download-prereqs-grid">
            {DESKTOP_DOWNLOAD.prerequisites.items.map((item) => (
              <div key={item.title} className="ui-public-download-prereq-card">
                <div className="ui-public-download-prereq-head">
                  <div>
                    <div className="ui-public-download-prereq-title">{item.title}</div>
                    <div className="ui-public-download-prereq-role">{item.role}</div>
                  </div>
                  <span
                    className={
                      item.required
                        ? "ui-public-download-prereq-required"
                        : "ui-public-download-prereq-optional"
                    }
                  >
                    {item.required ? "Required" : "Optional"}
                  </span>
                </div>
                <p className="ui-public-download-prereq-why">{item.whyYouNeedIt}</p>
                {item.command && (
                  <code className="ui-public-download-prereq-command">{item.command}</code>
                )}
                {item.href && item.installLabel && (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-public-download-prereq-link"
                  >
                    {item.installLabel}
                    <ExternalLink className="ui-public-download-prereq-link-icon" aria-hidden />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* For developers — collapsed by default so the page doesn't lead with jargon */}
        <div className="ui-public-download-dev">
          <button
            type="button"
            onClick={() => setShowDeveloper((s) => !s)}
            className="ui-public-download-dev-toggle"
            aria-expanded={showDeveloper}
          >
            <span>{DESKTOP_DOWNLOAD.developer.label}</span>
            <span className="ui-public-download-dev-toggle-icon">{showDeveloper ? "−" : "+"}</span>
          </button>
          {showDeveloper && (
            <div className="ui-public-download-dev-body">
              <p className="ui-public-download-dev-desc">
                {DESKTOP_DOWNLOAD.developer.description}
              </p>

              <div className="ui-public-download-dev-block">
                <div className="ui-public-download-dev-block-title">
                  {DESKTOP_DOWNLOAD.developer.buildFromSource.label}
                </div>
                <p className="ui-public-download-dev-block-body">
                  {DESKTOP_DOWNLOAD.developer.buildFromSource.body}
                </p>
                <code className="ui-public-download-dev-command">
                  {DESKTOP_DOWNLOAD.developer.buildFromSource.command}
                </code>
              </div>

              <div className="ui-public-download-dev-block">
                <div className="ui-public-download-dev-block-title">
                  {DESKTOP_DOWNLOAD.developer.headlessAgent.label}
                </div>
                <p className="ui-public-download-dev-block-body">
                  {DESKTOP_DOWNLOAD.developer.headlessAgent.body}
                </p>
                <code className="ui-public-download-dev-command">
                  {DESKTOP_DOWNLOAD.developer.headlessAgent.command}
                </code>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="ui-public-download-footer">
        The desktop app, the web, and your phone all connect to the same fleet. Use whichever
        surface is in front of you.
      </p>
    </div>
  );
}

/** Shown instead of the install flow when the visitor is on a phone or tablet.
 *  Names the constraint honestly, then offers the two paths that actually work
 *  from a handheld: use the web control plane now, or hand the link to the
 *  machine that can run the binary. */
function HandheldHandoff() {
  const { copied, copy } = useClipboard(FEEDBACK_MEDIUM_MS);
  const link = `${APP_URL}/download`;

  return (
    <div className="ui-public-download-handoff">
      <span className="ui-public-download-handoff-badge">
        <Smartphone className="h-3 w-3" aria-hidden />
        You&apos;re on a phone
      </span>
      <h3 className="ui-public-download-handoff-title">
        Fleet Runner installs on a computer — but you don&apos;t need it to start.
      </h3>
      <p className="ui-public-download-handoff-body">
        {APP_NAME} on the web is the full control plane: watch every agent, dispatch work, approve
        decisions, and drive a live terminal from this phone. Fleet Runner is what lets those agents
        touch files and run commands on your own machine — so install it there, whenever you&apos;re
        next in front of it.
      </p>
      <div className="ui-public-download-handoff-actions">
        <Link href={ROUTES.SIGN_UP} className="ui-public-download-handoff-primary">
          Open {APP_NAME} on the web
        </Link>
        <button
          type="button"
          onClick={() => copy(link)}
          className="ui-public-download-handoff-secondary"
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? "Link copied" : "Copy the install link"}
        </button>
      </div>
      <code className="ui-public-download-handoff-link">{link}</code>
    </div>
  );
}

function ReadyPlatformPanel({
  platform,
}: {
  platform: Extract<DesktopDownloadPlatform, { status: "ready" }>;
}) {
  return (
    <div className="ui-public-download-panel">
      <div className="flex flex-col items-center gap-3">
        <a href={platform.primary.url} className="ui-public-download-cta">
          {platform.primary.label}
          <span className="ui-public-download-cta-note">({platform.primary.note})</span>
        </a>
        {platform.secondary.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {platform.secondary.map((s) => (
              <a key={s.url} href={s.url} className="ui-public-download-secondary">
                {s.label}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="ui-public-download-command">
        <span>{platform.afterDownload}</span>
        <CopyableCommand command={platform.command} />
      </div>
    </div>
  );
}

function ComingSoonPanel({
  platform,
}: {
  platform: Extract<DesktopDownloadPlatform, { status: "comingSoon" }>;
}) {
  // Honest CTA instead of a Download button that 404s: Fleet Runner ships
  // Kept for a platform that genuinely has no asset yet. All three ship
  // today, so this is currently unreachable — do not delete it to "clean up"
  // unless the config can no longer express a comingSoon platform.
  return (
    <div className="ui-public-download-panel">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="ui-public-download-lede">
          The {platform.label} build is not published yet — watch releases to get the{" "}
          {platform.label} build the moment it lands, or use Loki on the web now.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href="https://github.com/bitbaum/loki-releases/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="ui-public-download-cta"
          >
            Watch releases
            <ExternalLink className="ui-public-download-prereq-link-icon" aria-hidden />
          </a>
          <Link href="/" className="ui-public-download-secondary">
            Use Loki on the web
          </Link>
        </div>
      </div>
    </div>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const { copied, copy } = useClipboard(FEEDBACK_MEDIUM_MS);

  return (
    <div className="ui-public-download-command-row">
      <code>{command}</code>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label={copied ? "Copied" : "Copy command"}
        className="ui-public-download-command-copy"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
