"use client";

import { useCallback, useRef, useSyncExternalStore, Suspense } from "react";
import {
  Bell,
  Bot,
  ChevronLeft,
  CreditCard,
  FolderKanban,
  KeyRound,
  Lock,
  MapPin,
  Mic,
  Palette,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";
import { ProfileSettings } from "./ProfileSettings";
import { AccountSettings } from "./AccountSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { PrivacySettings } from "./PrivacySettings";
import { LocationSettings } from "./LocationSettings";
import { VoiceSettings } from "./VoiceSettings";
import { AiBudgetSettings } from "./AiBudgetSettings";
import { AiQuotaSettings } from "./AiQuotaSettings";
import { OwnModelSettings } from "./OwnModelSettings";
import { BuildEngineChoice } from "./BuildEngineChoice";
import { ProviderOrderSettings } from "./ProviderOrderSettings";
import { AgentTokenSettings } from "./AgentTokenSettings";
import { ProviderInventorySettings } from "./ProviderInventorySettings";
import { BeaconSettings } from "./BeaconSettings";
import { BillingSettings, type BillingView } from "./BillingSettings";
import { ProjectsSettings } from "./ProjectsSettings";
import { TeamSettings } from "./TeamSettings";
import { NotificationSettings } from "./NotificationSettings";
import { PhonePushCard } from "./PhonePushCard";
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
    /** A builder on Loki's cloud (the founder's, or their own private one):
     *  Settings → AI then offers "also for building" on a key. */
    cloudBuilder: boolean;
  };
  /** Plan, expiry, the pass ledger and the Bitcoin checkout links — server-derived. */
  billing: BillingView;
  userPrefs: UserPreferencesData;
  projects: UserProject[];
  teamProjects: UserProject[];
  projectLimit: number | null;
  invitations: Invitation[];
  /** Whether the OrangeCat OIDC provider is mounted (env-gated, server-derived). */
  orangecatEnabled: boolean;
};

/** Every section, with the line its row says on a phone — what is in it, in
 *  the words a person would look for. */
const TABS = [
  { id: "profile", label: "Profile", icon: User, about: "Your name, username and photo" },
  { id: "account", label: "Account", icon: KeyRound, about: "Email, password and how you sign in" },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    about: "This phone, and email digests",
  },
  { id: "appearance", label: "Appearance", icon: Palette, about: "Light, dark or automatic" },
  { id: "voice", label: "Voice", icon: Mic, about: "How Loki writes and speaks for you" },
  { id: "ai", label: "AI", icon: Sparkles, about: "Your own models and what is left today" },
  { id: "privacy", label: "Privacy", icon: Lock, about: "Your PIN, and your data" },
  { id: "location", label: "Location", icon: MapPin, about: "Where you are, for weather and time" },
  { id: "agent", label: "Agent", icon: Bot, about: "Your computer, and which agent goes first" },
  { id: "projects", label: "Projects", icon: FolderKanban, about: "Every project and your limit" },
  { id: "team", label: "Team", icon: Users, about: "Invite someone to work with you" },
  { id: "billing", label: "Billing", icon: CreditCard, about: "Your plan and payments" },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon; about: string }[];

type TabId = (typeof TABS)[number]["id"];

// URL-hash aliases for incoming deep links — keeps existing URLs working
// even if the tab id changes. Direct tab id matches are auto-included.
const HASH_TO_TAB: Record<string, TabId> = {
  tokens: "agent", // /control's RunnerStatusBanner deep-links to #tokens
  "agent-token": "agent",
  "agent-tokens": "agent",
  // "Use your own model" links — from the budget refusal, docs, other apps.
  model: "ai",
  "own-model": "ai",
  byok: "ai",
  keys: "ai",
  // "Allowance" on Control's Tonight card — the night's settings live with the agent's.
  autopilot: "agent",
};

// The section the URL hash names, or null for none — on a phone that is the
// list of sections; from lg up, Profile. Pure, so it can be the store's
// client snapshot (see useSyncExternalStore in SettingsTabs).
function resolveInitialTab(): TabId | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.slice(1).toLowerCase();
  if (!raw) return null;
  const directMatch = TABS.find((t) => t.id === raw);
  if (directMatch) return directMatch.id;
  return HASH_TO_TAB[raw] ?? null;
}

/** Fired when a tab click rewrites the hash with replaceState (no hashchange). */
const TAB_EVENT = "settings-tab";

function subscribeToTab(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(TAB_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(TAB_EVENT, onChange);
  };
}

/** What the server renders — it cannot see a hash. */
function serverTab(): TabId | null {
  return null;
}

export function SettingsTabs({
  user,
  billing,
  userPrefs,
  projects,
  teamProjects,
  projectLimit,
  invitations,
  orangecatEnabled,
}: Props) {
  /**
   * The open tab IS the URL hash — one source of truth, read through
   * useSyncExternalStore so server and client agree.
   *
   * It used to be `useState(resolveInitialTab)`: the server, which has no
   * hash, rendered Profile; the browser, reading #ai, rendered AI; React threw
   * a hydration mismatch on every deep link into Settings and rebuilt the
   * tree. The store below gives React the server's answer (none) while
   * hydrating and the hash's answer right after, so deep links such as
   * /settings#agent (RunnerStatusBanner) and /settings#ai (the free-budget
   * refusal's "connect your own model") open the right tab with no mismatch —
   * and hash changes while already here (Back, in-app links) still follow.
   */
  const activeTab = useSyncExternalStore(subscribeToTab, resolveInitialTab, serverTab);

  /**
   * Choosing a section writes the hash, so the address can be shared,
   * bookmarked or reloaded onto it. On a phone the section is a page of its
   * own, so it is PUSHED — the back gesture returns to the list of sections,
   * as it does in every phone's settings. The rail (lg up) REPLACES, so
   * switching sections there does not stack history. Neither fires an event,
   * so the store is told directly.
   */
  const pushed = useRef(false);
  const selectTab = useCallback((id: TabId, push: boolean) => {
    if (push) {
      window.history.pushState(null, "", `#${id}`);
      pushed.current = true;
    } else {
      window.history.replaceState(null, "", `#${id}`);
    }
    window.dispatchEvent(new Event(TAB_EVENT));
  }, []);
  const backToList = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    window.dispatchEvent(new Event(TAB_EVENT));
  }, []);

  // From lg up there is always a section open; Profile when none is named.
  const shown: TabId = activeTab ?? "profile";

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      {/* The rail, lg up: all 12 sections at once. */}
      <nav className="hidden lg:flex lg:flex-col lg:gap-0.5 lg:self-start" aria-label="Settings">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => selectTab(tab.id, false)}
            aria-current={shown === tab.id ? "page" : undefined}
            className={`ui-settings-navitem ${shown === tab.id ? "ui-settings-navitem-active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Below lg with nothing chosen: the list of sections, each a row that
          opens it — the tab strip it replaced ran off the screen at "Not". */}
      {activeTab === null && (
        <List aria-label="Settings" className="lg:hidden">
          {TABS.map((tab) => (
            <ListRow
              key={tab.id}
              onClick={() => selectTab(tab.id, true)}
              icon={tab.icon}
              title={tab.label}
              secondary={tab.about}
              chevron
            />
          ))}
        </List>
      )}

      <div className={cn("ui-settings-pane min-w-0", activeTab === null && "max-lg:hidden")}>
        <div className="lg:hidden">
          <button type="button" onClick={backToList} className="ui-settings-back">
            <ChevronLeft className="h-5 w-5" aria-hidden />
            Settings
          </button>
        </div>
        <div>
          {shown === "profile" && (
            <ProfileSettings
              user={{ id: user.id, name: user.name, username: user.username, image: user.image }}
            />
          )}
          {shown === "account" && (
            <AccountSettings
              user={{ email: user.email, hasPassword: user.hasPassword }}
              orangecatEnabled={orangecatEnabled}
            />
          )}
          {shown === "notifications" && (
            <div className="space-y-6">
              <PhonePushCard />
              <NotificationSettings />
            </div>
          )}
          {shown === "appearance" && <AppearanceSettings />}
          {shown === "voice" && <VoiceSettings initialPrefs={userPrefs} />}
          {shown === "ai" && (
            <div className="space-y-6">
              {/* Your own model first: it is the way past the shared pool below. */}
              <AiBudgetSettings />
              {user.cloudBuilder && <BuildEngineChoice />}
              <OwnModelSettings cloudBuilder={user.cloudBuilder} />
              <AiQuotaSettings />
            </div>
          )}
          {shown === "privacy" && <PrivacySettings />}
          {shown === "location" && <LocationSettings initialPrefs={userPrefs} />}
          {shown === "agent" && (
            <div className="space-y-6">
              <ProviderInventorySettings />
              <ProviderOrderSettings initialPrefs={userPrefs} />
              <AgentTokenSettings />
              <BeaconSettings />
            </div>
          )}
          {shown === "projects" && (
            <ProjectsSettings
              projects={projects}
              teamProjects={teamProjects}
              projectLimit={projectLimit}
            />
          )}
          {shown === "team" && <TeamSettings invitations={invitations} />}
          {shown === "billing" && (
            <Suspense>
              <BillingSettings {...billing} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
