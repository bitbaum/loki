import * as React from "react";
import { createRoot } from "react-dom/client";
import { PhonePushView } from "@/components/settings/PhonePushView";
import { pushCardView, type PushStatus } from "@/lib/push-card";

// Every state the card can be in, stacked on one page, so one screenshot per
// theme and width shows them all. The container (PhonePushCard) is the part
// that needs a browser with push; this is the part that has to look right.
const STATES: {
  label: string;
  status: PushStatus;
  keyMissing?: boolean;
  isIos?: boolean;
  error?: string;
  note?: string;
}[] = [
  { label: "not asked yet", status: "default" },
  { label: "working", status: "registering" },
  { label: "on", status: "subscribed", note: "Sent to 1 device. It should buzz now." },
  { label: "blocked by the browser", status: "denied" },
  { label: "unsupported (iPhone)", status: "unsupported", isIos: true },
  { label: "unsupported (other)", status: "unsupported" },
  { label: "error", status: "error", error: "Registration failed" },
  { label: "server has no key", status: "default", keyMissing: true },
];

function App() {
  return (
    <div className="app-page mx-auto max-w-4xl space-y-4">
      <h1 className="ui-page-title">Settings · Notifications</h1>
      {STATES.map((s) => (
        <section key={s.label} className="space-y-1">
          <p className="ui-kicker">{s.label}</p>
          <PhonePushView
            view={pushCardView({
              status: s.status,
              keyMissing: !!s.keyMissing,
              isIos: !!s.isIos,
              error: s.error ?? null,
            })}
            working={s.status === "registering"}
            note={s.note ?? null}
            onAction={() => undefined}
          />
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
