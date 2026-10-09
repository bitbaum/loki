/**
 * Who reads the words. Two speakers behind one shape, so the conversation
 * hook does not care which is on:
 *
 *   synth   the browser's own voice (SpeechSynthesis). Free, offline, and
 *           what the Loki page's Talk button has always used.
 *   server  the studio voice: short pieces fetched from /api/voice/speak,
 *           decoded, and played through the soundscape's speech bus, so the
 *           music ducks under them and one media element carries it all.
 *           Fetches run one piece ahead of the one playing. Any failure
 *           hands the REST of the text to the synth speaker and stops
 *           asking the server for two minutes, so a box without a key, or
 *           a vendor having a bad hour, costs one hiccup and not a silence.
 *
 * Client-only (audio APIs), no React.
 */
import { guessSpeechLang } from "@/lib/loki/speech-text";
import { splitForSpeech } from "@/lib/voice/speak-chunks";

export type Speaker = {
  /** Resolves when the text has been read, or cut off. Never rejects. */
  speak(text: string): Promise<void>;
  cancel(): void;
};

const SERVER_RETRY_MS = 120_000;

export function createSynthSpeaker(): Speaker {
  let current: SpeechSynthesisUtterance | null = null;
  return {
    speak(text) {
      return new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = guessSpeechLang(text, document.documentElement.lang || "en");
        u.onend = () => {
          if (current === u) current = null;
          resolve();
        };
        u.onerror = u.onend;
        current = u;
        window.speechSynthesis.speak(u);
      });
    },
    cancel() {
      if (typeof window !== "undefined" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
      current = null;
    },
  };
}

export function createServerSpeaker(opts: {
  voice: string;
  ctx: AudioContext;
  out: AudioNode;
  fallback: Speaker;
}): Speaker {
  let token = 0;
  let source: AudioBufferSourceNode | null = null;
  let abort: AbortController | null = null;
  let brokenUntil = 0;

  const fetchPiece = async (text: string, signal: AbortSignal): Promise<AudioBuffer> => {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: opts.voice }),
      signal,
    });
    if (!res.ok) throw new Error(`speak ${res.status}`);
    const bytes = await res.arrayBuffer();
    return opts.ctx.decodeAudioData(bytes);
  };

  const play = (buffer: AudioBuffer, my: number): Promise<void> =>
    new Promise((resolve) => {
      if (my !== token) return resolve();
      const s = opts.ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(opts.out);
      s.onended = () => {
        if (source === s) source = null;
        resolve();
      };
      source = s;
      s.start();
    });

  return {
    async speak(text) {
      const my = ++token;
      if (Date.now() < brokenUntil) return opts.fallback.speak(text);
      const pieces = splitForSpeech(text);
      abort = new AbortController();
      const { signal } = abort;
      let next: Promise<AudioBuffer> | null = pieces.length ? fetchPiece(pieces[0], signal) : null;
      for (let i = 0; i < pieces.length; i++) {
        if (my !== token) return;
        let buffer: AudioBuffer;
        try {
          buffer = await (next as Promise<AudioBuffer>);
        } catch {
          if (my !== token) return;
          brokenUntil = Date.now() + SERVER_RETRY_MS;
          return opts.fallback.speak(pieces.slice(i).join(" "));
        }
        // Fetch the next piece while this one plays, so the cut is not a pause.
        next = i + 1 < pieces.length ? fetchPiece(pieces[i + 1], signal) : null;
        next?.catch(() => {});
        await play(buffer, my);
      }
    },
    cancel() {
      token++;
      abort?.abort();
      abort = null;
      try {
        source?.stop();
      } catch {
        /* already ended */
      }
      source = null;
      opts.fallback.cancel();
    },
  };
}
