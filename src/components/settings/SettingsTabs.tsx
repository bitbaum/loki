"use client";

import { useState, Suspense } from "react";
import { ScrollAffordance } from "@/components/ui/scroll-affordance";
import { ProfileSettings } from "./ProfileSettings";
import { AccountSettings } from "./AccountSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { PrivacySettings } from "./PrivacySettings";
import { LocationSettings } from "./LocationSettings";
import { VoiceSettings } from "./VoiceSettings";
import { AiQuotaSettings } from "./AiQuotaSettings";
import { ProviderOrderSettings } from "./ProviderOrderSettings";
import { AgentTokenSettings } from "./AgentTokenSettings";
import { BeaconSettings } from "./BeaconSettings";
import { BillingSettings } from "./BillingSettings";
import { ProjectsSettings } from "./ProjectsSettings";
import { TeamSettings } from "./TeamSettings";
import { NotificationSettings } from "./NotificationSettings";
import type { UserPreferencesData } from "@/db/queries/user-preferences";
import type { Plan } from "@/db/schema/users";
import type { UserProject, Invitation } from "@/db/schema";

type Props = {
  user: {
    id: string;
    name: string;
    username: string;
    image: string;
    email: string | null;
    hasPassword: boolean;
    plan: Plan;
    planStatus: string | null;
  };
  userPrefs: UserPreferencesData;
  projects: UserProject[];
  teamProjects: UserProject[];
  projectLimit: number | null;
  invitations: Invitation[];
  /** Whether the OrangeCat OIDC provider is mounted (env-gated, server-derived). */
  orangecatEnabled: boolean;
};

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "account", label: "Account" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "voice", label: "Voice" },
  { id: "ai", label: "AI" },
  { id: "privacy", label: "Privacy" },
  { id: "location", label: "Location" },
  { id: "agent", label: "Agent" },
  { id: "projects", label: "Projects" },
  { id: "team", label: "Team" },
  { id: "billing", label: "Billing" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// URL-hash aliases for incoming deep links — keeps existing URLs working
// even if the tab id changes. Direct tab id matches are auto-included.
const HASH_TO_TAB: Record<string, TabId> = {
  tokens: "agent", // /control's RunnerStatusBanner deep-links to #tokens
  "agent-token": "agent",
  "agent-tokens": "agent",
};

// Resolve the initial tab from window.location.hash. Pure function so it can
// run inside a useState lazy initializer — avoids the cascading-render lint
// hit from a post-mount setState in useEffect.
function resolveInitialTab(): TabId {
  if (typeof window === "undefined") return "profile";
  const raw = window.location.hash.slice(1).toLowerCase();
  if (!raw) return "profile";
  const directMatch = TABS.find((t) => t.id === raw);
  if (directMatch) return directMatch.id;
  return HASH_TO_TAB[raw] ?? "profile";
}

export function SettingsTabs({
  user,
  userPrefs,
  projects,
  teamProjects,
  projectLimit,
  invitations,
  orangecatEnabled,
}: Props) {
  // Lazy initializer reads the URL hash once at first render so deep links
  // like /settings#agent or /settings#tokens (from RunnerStatusBanner's
  // onboarding link) open the right tab. Without this, the banner landed
  // the user on Profile and they had to discover the Agent tab themselves
  // — a silent dead-end in the new-user funnel.
  const [activeTab, setActiveTab] = useState<TabId>(resolveInitialTab);

  return (
    <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
      {/* Nav: a vertical left rail on lg+ (all 12 sections visible — the old
          horizontal bar overflowed 4 off-screen), falling back to the
          horizontal scroll bar under lg. */}
      <nav className="lg:self-start">
        {/* Mobile / tablet: horizontal scroll bar */}
        <div className="border-b border-border-subtle -mx-4 px-4 mb-6 lg:hidden">
          <ScrollAffordance childCount={TABS.length} threshold={4}>
            <div className="overflow-x-auto ui-scroll-fade-right [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`ui-tab ${activeTab === tab.id ? "ui-tab-active" : ""}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </ScrollAffordance>
        </div>
        {/* Desktop: vertical rail */}
        <div className="hidden lg:flex lg:flex-col lg:gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`ui-settings-navitem ${activeTab === tab.id ? "ui-settings-navitem-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Tab content */}
      <div className="min-w-0">
        {activeTab === "profile" && (
          <ProfileSettings
            user={{ id: user.id, name: user.name, username: user.username, image: user.image }}
          />
        )}
        {activeTab === "account" && (
          <AccountSettings
            user={{ email: user.email, hasPassword: user.hasPassword }}
            orangecatEnabled={orangecatEnabled}
          />
        )}
        {activeTab === "notifications" && <NotificationSettings />}
        {activeTab === "appearance" && <AppearanceSettings />}
        {activeTab === "voice" && <VoiceSettings initialPrefs={userPrefs} />}
        {activeTab === "ai" && <AiQuotaSettings />}
        {activeTab === "privacy" && <PrivacySettings />}
        {activeTab === "location" && <LocationSettings initialPrefs={userPrefs} />}
        {activeTab === "agent" && (
          <div className="space-y-6">
            <ProviderOrderSettings initialPrefs={userPrefs} />
            <AgentTokenSettings />
            <BeaconSettings />
          </div>
        )}
        {activeTab === "projects" && (
          <ProjectsSettings
            projects={projects}
            teamProjects={teamProjects}
            projectLimit={projectLimit}
          />
        )}
        {activeTab === "team" && <TeamSettings invitations={invitations} />}
        {activeTab === "billing" && (
          <Suspense>
            <BillingSettings plan={user.plan} planStatus={user.planStatus} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
