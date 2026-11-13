import Link from "next/link";
import { Check, Laptop } from "lucide-react";
import { CUSTOM_VENDOR_ID } from "@/config/model-vendors";
import { ownModelAddPath } from "@/lib/own-model-path";

/** Optional computer setup; hosted Loki sends requests to this endpoint. */
export function LocalModels({ hasEndpoint }: { hasEndpoint: boolean }) {
  return (
    <section id="local" aria-labelledby="local-title" className="ui-store-local">
      <div className="flex items-start gap-3">
        <Laptop className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          {/* The most technical, optional part of the page: one line and a
              secondary button, the how-to folded. It had the page's only
              primary button and a paragraph of tunnels and "OpenAI shape"
              above the choices a person actually makes here (2026-11-12). */}
          <div>
            <h2 id="local-title" className="font-medium text-text-primary">
              Run a model on your own computer
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Optional. Loki works from your phone without it.
            </p>
          </div>
          <details>
            <summary className="ui-tap text-sm text-text-primary">How to set it up</summary>
            <div className="space-y-3 pt-2">
              <p className="text-sm text-text-secondary">
                Choose a model your computer can run: being free to download does not mean it fits
                on a laptop. Messages still travel through Loki&apos;s server to your computer, so
                it is not an offline chat. Hardware and electricity may cost you.
              </p>
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
                  <code className="inline">cloudflared tunnel --url http://localhost:11434</code>,
                  or <code className="inline">ngrok http 11434</code>. Each prints an https address.
                </li>
                <li>
                  <span className="font-medium text-text-primary">Tell Loki.</span> Paste that
                  address with <code className="inline">/v1</code> on the end. Loki checks it, lists
                  the models it finds, and you pick one.
                </li>
              </ol>
              <p className="text-xs text-text-muted">
                Your computer must stay on and online. Protect the address before you share it: Loki
                sends the whole conversation to it, not just the latest message.
              </p>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            {hasEndpoint ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-status-positive">
                <Check className="h-4 w-4" aria-hidden="true" /> Your endpoint is connected
              </span>
            ) : (
              <Link href={ownModelAddPath(CUSTOM_VENDOR_ID)} className="ui-btn-secondary text-sm">
                Add your endpoint
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
