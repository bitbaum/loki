/** The chat chunk's entry: announce the renderer for widget/chat-loader.ts. */
import { KIT_GLOBAL } from "./contract";
import { kit } from "./view";

(window as unknown as Record<string, unknown>)[KIT_GLOBAL] = kit;
window.dispatchEvent(new Event(KIT_GLOBAL));
