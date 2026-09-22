"use client";

import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { APP_NAME } from "@/config/brand";

export function AppearanceSettings() {
  return (
    <div className="space-y-6">
      <div className="ui-settings-section">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Theme</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            Choose how {APP_NAME} looks. Auto follows your OS preference. The same control sits in
            the account menu — your avatar, top right — if you want it while working. This choice is
            remembered in this browser, so a different device starts on Dark until you choose there
            too.
          </p>
        </div>
        <ThemeToggle variant="select" />
      </div>
    </div>
  );
}
