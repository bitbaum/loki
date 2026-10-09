import type { Metadata } from "next";
import { NoScreenMode } from "@/components/voice/NoScreenMode";
import { requirePageUserId } from "@/lib/session";

export const metadata: Metadata = { title: "No-screen mode" };

// No-screen mode — the fleet by ear. One tap, then the phone goes in the
// pocket: Loki reads the fleet aloud, listens, acts, and announces what
// changes. The loop lives in components/voice/NoScreenMode.
export default async function VoicePage() {
  await requirePageUserId();
  return (
    <div className="app-page app-viewport-pane flex flex-col">
      <NoScreenMode />
    </div>
  );
}
