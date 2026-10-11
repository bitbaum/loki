"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  BROWSER_EXTENSION,
  BROWSER_EXTENSION_LISTING_URL,
  type BrowserRecipeId,
  type BrowserTask,
} from "@/config/browser-tasks";

/** What this device can do with the form. Decided once, on mount. */
type Filler = "extension" | "fleet-runner" | "none";

type Status = { tone: "info" | "error"; text: string } | null;

const noSubscription = () => () => {};

function detectFiller(): Filler {
  // The extension's script on this origin runs at document_start, so the
  // marker is there before React hydrates.
  if (document.documentElement.dataset[BROWSER_EXTENSION.marker]) return "extension";
  if ((window as unknown as { fleetRunner?: unknown }).fleetRunner) return "fleet-runner";
  return "none";
}

/** Ask the Loki extension to open and fill the form in a new tab. */
function askExtension(recipe: BrowserRecipeId, params: Record<string, string>) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onReply);
      resolve({ ok: false, error: "The Loki extension did not answer." });
    }, 5000);
    function onReply(event: MessageEvent) {
      const data = event.data as { type?: string; reply?: { ok: boolean; error?: string } } | null;
      if (event.source !== window || data?.type !== BROWSER_EXTENSION.reply) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onReply);
      resolve(data.reply ?? { ok: false });
    }
    window.addEventListener("message", onReply);
    window.postMessage({ type: BROWSER_EXTENSION.request, recipe, params }, window.location.origin);
  });
}

async function sendToComputer(recipe: BrowserRecipeId, params: Record<string, string>) {
  const res = await fetch("/api/browser-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, params }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? { ok: true } : { ok: false, error: body.error ?? `Failed (${res.status})` };
}

export function FillHandoff({
  recipe,
  params,
  task,
}: {
  recipe: BrowserRecipeId;
  params: Record<string, string>;
  task: BrowserTask;
}) {
  // Read from the document, not React state: null on the server, the real
  // answer on the client. Neither the marker nor window.fleetRunner changes
  // after load, so there is nothing to subscribe to.
  const filler = useSyncExternalStore<Filler | null>(noSubscription, detectFiller, () => null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const button = `“${task.handoff.button}”`;

  async function run(where: "here" | "computer") {
    setBusy(true);
    setStatus(null);
    const result =
      where === "here" && filler === "extension"
        ? await askExtension(recipe, params)
        : await sendToComputer(recipe, params);
    setBusy(false);
    if (!result.ok) {
      setStatus({
        tone: "error",
        text: `${result.error ?? "That didn't work."} The values below still work by hand.`,
      });
      return;
    }
    setStatus({
      tone: "info",
      text:
        where === "here" && filler === "extension"
          ? `Opened ${task.host} in a new tab. Loki is filling it — check it, then press ${button}. If it asks you to sign in, sign in; Loki carries on.`
          : filler === "fleet-runner"
            ? `Opening in Loki's browser window. Check it, then press ${button}.`
            : `Sent to Fleet Runner on your computer. It opens filled, waiting for you to press ${button}.`,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="ui-kicker">Loki fills in</div>
        <FilledValues task={task} />
        <div className="flex flex-wrap gap-2 mt-4">
          {filler === "extension" && (
            <button
              type="button"
              className="ui-btn-primary min-h-11"
              disabled={busy}
              onClick={() => run("here")}
            >
              Fill it in this browser
            </button>
          )}
          {filler === "fleet-runner" && (
            <button
              type="button"
              className="ui-btn-primary min-h-11"
              disabled={busy}
              onClick={() => run("computer")}
            >
              Fill it on this computer
            </button>
          )}
          {filler === "none" && (
            <button
              type="button"
              className="ui-btn-primary min-h-11"
              disabled={busy}
              onClick={() => run("computer")}
            >
              Send to my computer
            </button>
          )}
          <a
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-btn-secondary min-h-11 inline-flex items-center gap-2"
          >
            Open {task.host}
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        {status && (
          <p
            role="status"
            className={`text-sm mt-3 ${status.tone === "error" ? "ui-error" : "text-text-secondary"}`}
          >
            {status.text}
          </p>
        )}
      </Card>
      {filler === "none" && (
        <Card>
          <p className="text-sm md:text-base font-medium">Want Loki to fill it right here?</p>
          <p className="text-xs md:text-sm text-text-secondary mt-1">
            A web page can&apos;t type into another site — browsers forbid it, so no site can fill
            your bank&apos;s forms. The Loki extension for Firefox (Android and desktop) can, and
            stops at the final button the same way.
            {BROWSER_EXTENSION_LISTING_URL
              ? ""
              : " It is on its way to the Firefox add-ons store; until then, send it to your computer or tap the values above to copy them."}
          </p>
          {BROWSER_EXTENSION_LISTING_URL && (
            <a
              href={BROWSER_EXTENSION_LISTING_URL}
              className="ui-btn-secondary min-h-11 inline-flex items-center gap-2 mt-3"
            >
              Get Loki for Firefox
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </Card>
      )}
    </div>
  );
}

/** Every value the form needs, each one tap from the clipboard — the fast way
 *  by hand on a device with no filler. */
function FilledValues({ task }: { task: BrowserTask }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      // Denied clipboard: the value is on screen and selectable.
    }
  }
  return (
    <ul className="flex flex-col gap-2 mt-2">
      {task.steps.map((step) =>
        step.kind === "fill" ? (
          <li
            key={step.label}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-w-0"
          >
            <span className="text-sm text-text-secondary shrink-0">{step.label}</span>
            <button
              type="button"
              className="ui-btn-chip min-h-11 inline-flex items-center gap-2 min-w-0"
              onClick={() => copy(step.value)}
              aria-label={`Copy ${step.label}: ${step.value}`}
            >
              <span className="font-mono break-all text-left">{step.value}</span>
              {copied === step.value ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : (
                <Copy className="h-4 w-4 shrink-0" />
              )}
            </button>
          </li>
        ) : step.kind === "check" ? (
          <li key={step.label} className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-secondary">{step.label}</span>
            <span className="text-sm">{step.checked ? "ticked" : "unticked"}</span>
          </li>
        ) : null,
      )}
    </ul>
  );
}
