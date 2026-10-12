/**
 * Loads the chat chunk (public/widget-chat.js, widget/chat/) — the shared chat
 * the panel draws its conversation with — once, on demand.
 *
 * Never a dead end: if the chunk cannot load (blocked by a site's CSP, offline,
 * slow), the promise resolves to null and the panel keeps the conversation it
 * draws itself (conversation.ts). The script tag carries the widget tag's
 * nonce, so a site whose CSP allows the widget by nonce allows this too.
 */
import { KIT_GLOBAL, type KitModule } from "./chat/contract";

const LOAD_TIMEOUT_MS = 8000;
let loading: Promise<KitModule | null> | null = null;

export function loadChat(apiBase: string, nonce?: string): Promise<KitModule | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const w = window as unknown as Record<string, unknown>;
    const ready = () => (w[KIT_GLOBAL] as KitModule | undefined) ?? null;
    if (ready()) return resolve(ready());
    const done = (mod: KitModule | null) => {
      clearTimeout(timer);
      window.removeEventListener(KIT_GLOBAL, onReady);
      resolve(mod);
    };
    const onReady = () => done(ready());
    const timer = setTimeout(() => done(ready()), LOAD_TIMEOUT_MS);
    window.addEventListener(KIT_GLOBAL, onReady);
    const s = document.createElement("script");
    s.src = `${apiBase}/widget-chat.js`;
    s.async = true;
    if (nonce) s.nonce = nonce;
    s.onerror = () => done(null);
    document.head.appendChild(s);
  });
  return loading;
}
