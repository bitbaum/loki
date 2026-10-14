import Link from "next/link";
import { Check, Laptop } from "lucide-react";
import { CUSTOM_VENDOR_ID } from "@/config/model-vendors";
import { ownModelAddPath } from "@/lib/own-model-path";

/** Optional computer setup; hosted Loki sends requests to this endpoint. */
export function LocalModels({ hasEndpoint }: { hasEndpoint: boolean }) {
  return (
    <section id="local" aria-labelledby="local-title" className="ui-store-local">
      <div className="flex items-start gap-3">
        <Laptop className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 id="local-title" className="font-medium text-text-primary">
              On your own machine
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              You can connect a compatible model running on your own computer. Choose one your
              hardware can run; open weights alone do not guarantee laptop compatibility. This is
              optional — you can use Loki from your phone with the shared pool or a provider key.
              Requests travel through Loki&apos;s server to your endpoint; this is not an offline,
              device-only chat. Hardware, electricity and hosting may cost you.
            </p>
          </div>
          <details>
            <summary className="ui-tap text-sm text-text-primary">
              Computer setup instructions
            </summary>
            <ol className="ui-store-steps">
              <li>
                <span className="font-medium text-text-primary">Run a model.</span> Install{" "}
                <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">
                  Ollama
                </a>{" "}
                or{" "}
                <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">
                  LM Studio
                </a>
                , pull a model and start the server:
                <code>ollama pull qwen3 &amp;&amp; ollama serve</code>
              </li>
              <li>
                <span className="font-medium text-text-primary">Give it an address.</span> With{" "}
                <a
                  href="https://tailscale.com/kb/1223/funnel"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tailscale Funnel
                </a>
                , <code className="inline">tailscale funnel 11434</code> — or{" "}
                <code className="inline">cloudflared tunnel --url http://localhost:11434</code>, or{" "}
                <code className="inline">ngrok http 11434</code>. Each prints an https URL.
              </li>
              <li>
                <span className="font-medium text-text-primary">Tell Loki.</span> Paste that URL
                with <code className="inline">/v1</code> on the end — Ollama and LM Studio both
                speak the OpenAI shape there. Loki checks it, lists the models it finds, and you
                pick one.
              </li>
            </ol>
          </details>
          <p className="text-xs text-text-muted">
            Your computer and HTTPS endpoint must stay online. Protect access to the endpoint before
            publishing it. Loki sends conversation context to it, not just the latest message.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {hasEndpoint ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-status-positive">
                <Check className="h-4 w-4" aria-hidden="true" /> Your endpoint is connected
              </span>
            ) : (
              <Link href={ownModelAddPath(CUSTOM_VENDOR_ID)} className="ui-btn-primary text-sm">
                Add your endpoint
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
