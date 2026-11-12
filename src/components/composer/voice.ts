import type { ComposerVoice } from "@bitbaum/chatkit/react";

/**
 * Loki's microphone, the one server leg every chatkit box in the app uses:
 * the Composer and every <TextArea>. Groq Whisper behind the operator's
 * session.
 *
 * `prefer: "server"`: dictation here is often mixed German and English, which
 * one Whisper model handles better than a browser recogniser locked to a
 * single language. chatkit still falls back to the browser recogniser.
 *
 * `showServerDetail`: since chatkit 0.24 the route's own sentence is hidden by
 * default, because a server's words are in the server's language. Loki's pages
 * and its transcribe route are both English, and that sentence is the one that
 * names the fix ("Pick Groq under Settings → Agent", "No speech detected"), so
 * it stays.
 */
export const LOKI_VOICE = {
  transcribeUrl: "/api/control/transcribe",
  prefer: "server",
  showServerDetail: true,
} as const satisfies ComposerVoice;

/**
 * The microphone for a visitor who is not signed in (the homepage's box,
 * /change): the browser's own recogniser, nothing sent to Loki. The server
 * leg above answers a signed-out request with 401, so on those pages the mic
 * recorded a whole take and then failed, under a hint that said "use the mic
 * and say it". Where the browser has no recogniser, chatkit draws no mic.
 */
export const VISITOR_VOICE = { prefer: "browser" } as const satisfies ComposerVoice;
