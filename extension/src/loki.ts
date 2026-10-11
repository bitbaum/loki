/**
 * Runs on Loki's own site only. It tells the page the extension is here
 * (a data attribute the /fill page reads) and forwards a hand-off the page
 * posts — from this window, on this origin — to the background.
 */
import { BROWSER_EXTENSION } from "@/config/browser-tasks";
import { api } from "./api";

document.documentElement.dataset[BROWSER_EXTENSION.marker] = "1";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { type?: string; recipe?: unknown; params?: unknown } | null;
  if (!data || data.type !== BROWSER_EXTENSION.request) return;
  void api.runtime
    .sendMessage({ kind: "start", recipe: data.recipe, params: data.params })
    .then((reply) => window.postMessage({ type: BROWSER_EXTENSION.reply, reply }, location.origin))
    .catch((e: Error) =>
      window.postMessage(
        { type: BROWSER_EXTENSION.reply, reply: { ok: false, error: e.message } },
        location.origin,
      ),
    );
});
