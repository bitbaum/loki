/**
 * The extension's background: turns a request from Loki's page into a tab
 * with a task attached, and hands that task to the filler running in the tab.
 *
 * The task is resolved HERE, from the recipe config bundled into the
 * extension, never taken as steps from the page — the same gate Fleet Runner
 * uses (config/browser-tasks.ts). A task belongs to one tab; it is forgotten
 * when the form is ready or the tab closes, so a later visit to the same page
 * is never filled again by surprise.
 */
import { APP_DOMAIN } from "@/config/brand";
import { resolveBrowserTask, type BrowserTask } from "@/config/browser-tasks";
import { api, type ExtensionMessage } from "./api";

const key = (tabId: number) => `task:${tabId}`;

api.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const message = raw as ExtensionMessage;
  const tabId = sender.tab?.id;
  void (async () => {
    if (message.kind === "start") {
      // Only Loki's own script sends this; it runs on Loki's origin alone
      // (see the manifest), and it re-checks the page origin before sending.
      if (!sender.url?.startsWith(`https://${APP_DOMAIN}/`)) {
        return sendResponse({ ok: false, error: "not from Loki" });
      }
      const task = resolveBrowserTask(message.recipe, message.params);
      if (!task) return sendResponse({ ok: false, error: "unknown recipe or invalid params" });
      const tab = await api.tabs.create({ url: task.url });
      if (tab.id !== undefined) await api.storage.session.set({ [key(tab.id)]: task });
      return sendResponse({
        ok: true,
        title: task.title,
        button: task.handoff.button,
        host: task.host,
      });
    }
    if (tabId === undefined) return sendResponse(null);
    if (message.kind === "task-for-tab") {
      const stored = await api.storage.session.get(key(tabId));
      return sendResponse((stored[key(tabId)] as BrowserTask | undefined) ?? null);
    }
    if (message.kind === "finished") {
      await api.storage.session.remove(key(tabId));
      return sendResponse({ ok: true });
    }
    sendResponse(null);
  })();
  return true; // the response is sent asynchronously
});

api.tabs.onRemoved.addListener((tabId) => void api.storage.session.remove(key(tabId)));
