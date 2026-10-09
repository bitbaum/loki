/**
 * The sounds of no-screen mode, as NUMBERS. Pure: the WebAudio plumbing that
 * turns these into air lives in hooks/use-soundscape.ts, and this file is
 * pinned by scripts/test/voice-soundscape.ts without a speaker.
 *
 * Earcons are the auditory-display idea from the 1980s: a short, learnable
 * sound that says what KIND of news is coming before any word is spoken,
 * so the ear can decide how much attention to pay. Rising is good, falling
 * is bad, two equal notes is a knock on the door. Each is under half a
 * second; a jingle would be the annoyance it exists to prevent.
 *
 * The music bed is generated, not played back: a slow chord progression on
 * detuned sine and triangle waves through a drifting low-pass filter and a
 * feedback delay. No file, no licence, no stream, and it costs nothing to
 * leave on for an hour. Its job is to make silence sound like a line that
 * is still open, and to duck under the voice so the words stay first.
 */

export type EarconKind = "heard" | "finished" | "failed" | "attention" | "offline" | "online";

/** One note of an earcon: MIDI pitch, start offset and length in seconds. */
export type EarconNote = { midi: number; at: number; dur: number };

export const EARCONS: Record<EarconKind, EarconNote[]> = {
  /** One high blip: "I heard you", played the moment a take is sent. */
  heard: [{ midi: 84, at: 0, dur: 0.08 }],
  /** A rising major triad: something finished. */
  finished: [
    { midi: 72, at: 0, dur: 0.12 },
    { midi: 76, at: 0.13, dur: 0.12 },
    { midi: 79, at: 0.26, dur: 0.22 },
  ],
  /** A falling minor third: something failed. */
  failed: [
    { midi: 67, at: 0, dur: 0.18 },
    { midi: 63, at: 0.2, dur: 0.32 },
  ],
  /** Two equal notes, a knock: something needs you. */
  attention: [
    { midi: 76, at: 0, dur: 0.1 },
    { midi: 76, at: 0.18, dur: 0.1 },
  ],
  /** Low and falling: the line dropped. */
  offline: [
    { midi: 60, at: 0, dur: 0.2 },
    { midi: 55, at: 0.22, dur: 0.36 },
  ],
  /** Low and rising: the line is back. */
  online: [
    { midi: 55, at: 0, dur: 0.15 },
    { midi: 60, at: 0.17, dur: 0.26 },
  ],
};

/** Every earcon ends well under a second: a cue, never a jingle. */
export const EARCON_MAX_SECONDS = 0.6;

export const MUSIC = {
  /** Bed level while nobody is talking. Quiet: it is a floor, not a song. */
  level: 0.09,
  /** Bed level under the voice. */
  ducked: 0.025,
  /** Seconds a chord holds before the next one fades in. */
  chordSeconds: 18,
  attackSeconds: 5,
  releaseSeconds: 6,
  /** The low-pass filter's centre and how far its slow LFO sweeps it. */
  filterHz: 900,
  filterSweepHz: 250,
  filterLfoHz: 0.04,
  delaySeconds: 0.55,
  delayFeedback: 0.32,
  /** Two oscillators per note, this far apart, is what makes it breathe. */
  detuneCents: 5,
} as const;

/**
 * The progression, as MIDI notes, low to high. Six chords in D that resolve
 * nowhere in particular — the point is a bed, not a tune — rooted low enough
 * to sit under speech (the voice lives in the 1–4 kHz band; this does not).
 */
export const MUSIC_PROGRESSION: readonly (readonly number[])[] = [
  [50, 57, 62, 66], // D  A  D  F#   D major
  [47, 54, 59, 62], // B  F# B  D    B minor
  [43, 50, 57, 61], // G  D  A  C#   G major 7
  [45, 52, 57, 61], // A  E  A  C#   A major
  [50, 57, 62, 64], // D  A  D  E    D sus2
  [48, 55, 59, 62], // C  G  B  D    C major 7
];

export function chordAt(index: number): readonly number[] {
  const n = MUSIC_PROGRESSION.length;
  return MUSIC_PROGRESSION[((index % n) + n) % n];
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
