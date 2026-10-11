/**
 * The WebExtension API, whichever name this browser gives it. Firefox (the
 * target, on Android and desktop) exposes `browser`; Chromium exposes `chrome`
 * and is used only to test the extension under Playwright. Messaging below
 * uses the callback form both understand.
 */
type Listener = (
  message: unknown,
  sender: { tab?: { id?: number }; url?: string },
  sendResponse: (response: unknown) => void,
) => boolean | void;

export type ExtensionApi = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: { addListener(listener: Listener): void };
  };
  tabs: {
    create(props: { url: string }): Promise<{ id?: number }>;
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  storage: {
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
};

const g = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
export const api: ExtensionApi = (g.browser ?? g.chrome) as ExtensionApi;

/** Messages between the extension's own scripts. */
export type ExtensionMessage =
  | { kind: "start"; recipe: string; params: Record<string, string> }
  | { kind: "task-for-tab" }
  | { kind: "finished"; state: "ready" | "timeout" };
