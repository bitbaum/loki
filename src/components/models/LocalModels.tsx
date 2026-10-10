import Link from "next/link";
import { Check, Laptop } from "lucide-react";
import { CUSTOM_VENDOR_ID } from "@/config/model-vendors";
import { ownModelAddPath } from "@/lib/own-model-path";

/**
 * "On your own machine": how a laptop becomes a provider.
 *
 * Honest about the shape of it. Loki's server cannot reach a laptop, so the
 * model has to be reachable on a public https address — a tunnel gives that
 * in one command — and the laptop has to be on. In return the model is free
 * and the data never leaves the machine. Every open-weight model in the
 * table above can be pulled; the recipe names the two tools most people
 * already have.
 */
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
              Any model marked <span className="ui-store-badge-open">Open weights</span> can run on
              your laptop, and then Loki costs nothing to think with: no key, no bill, and your data
              never leaves the machine. Loki&apos;s server cannot see your laptop, so it needs a
              public https address for it — a tunnel does that in one command.
            </p>
          </div>
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
              <code>ollama pull qwen3 &amp;&amp; OLLAMA_HOST=0.0.0.0 ollama serve</code>
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
              <span className="font-medium text-text-primary">Tell Loki.</span> Paste that URL with{" "}
              <code className="inline">/v1</code> on the end — Ollama and LM Studio both speak the
              OpenAI shape there. Loki checks it, lists the models it finds, and you pick one.
            </li>
          </ol>
          <p className="text-xs text-text-muted">
            The laptop has to be on and the tunnel up for Loki to use it; when it is not, Loki tells
            you rather than guessing. A small model answers in a few seconds on a recent laptop; a
            30B one wants a proper GPU. Loki only ever connects over https, never to a private
            address, and sends nothing to your endpoint but your own turns.
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
