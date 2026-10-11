/**
 * Runs on the hosts recipes fill. Does nothing unless the background holds a
 * task for THIS tab — one Loki opened a moment ago. Then it runs the same
 * filler Fleet Runner runs, every POLL_MS, until the form is ready: through a
 * sign-in page and back (the script is re-injected on each page load and asks
 * again), never pressing the hand-off button.
 */
import type { BrowserTask } from "@/config/browser-tasks";
import { fillBrowserForm } from "@/lib/browser-fill";
import { api } from "./api";

const POLL_MS = 700;
const GIVE_UP_MS = 15 * 60_000;

void (async () => {
  const task = (await api.runtime.sendMessage({ kind: "task-for-tab" })) as BrowserTask | null;
  if (!task) return;
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > GIVE_UP_MS) {
      clearInterval(timer);
      void api.runtime.sendMessage({ kind: "finished", state: "timeout" });
      return;
    }
    if (fillBrowserForm(task).state === "ready") {
      clearInterval(timer);
      void api.runtime.sendMessage({ kind: "finished", state: "ready" });
    }
  }, POLL_MS);
})();
