"use client";

import { useCallback, useEffect, useRef } from "react";
import { EARCONS, MUSIC, chordAt, midiToHz, type EarconKind } from "@/lib/voice/soundscape";

/**
 * The air around the voice: one AudioContext that carries the earcons, the
 * generated music bed and the studio voice, and ONE MediaStream out of it
 * that an <audio> element plays — so the phone treats the whole thing as a
 * track (lock-screen controls, keeps playing with the screen off where the
 * platform allows a track to) rather than as a page making noises.
 *
 * `arm()` must run inside a tap: a browser will not start an AudioContext
 * outside a gesture, and the whole mode is one tap followed by a pocket.
 *
 * Graph:  music voices → filter → (dry + delay) → musicGain ─┐
 *         earcons ──────────────────────────────────────────┼→ master → stream → <audio>
 *         speech (server voice buffers) ────────────────────┘        (or → destination, direct)
 *
 * One output, never both: master feeds EITHER the stream the element plays
 * OR the context's destination. Both at once is everything twice.
 */
export function useSoundscape() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const musicInRef = useRef<AudioNode | null>(null);
  const speechRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const musicTimerRef = useRef<number | null>(null);
  const chordVoicesRef = useRef<{ oscs: OscillatorNode[]; gain: GainNode }[]>([]);
  const chordIndexRef = useRef(0);

  const directRef = useRef(false);

  /** Play straight out of the context, not (only) through the media element:
   *  for the public demo, which has no element, and as the fallback when the
   *  element is refused. Connecting both would play everything twice. */
  const connectDirect = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!ctx || !master || directRef.current) return;
    master.connect(ctx.destination);
    directRef.current = true;
  }, []);

  const arm = useCallback(
    (opts?: {
      direct?: boolean;
    }): { ctx: AudioContext; speech: AudioNode; stream: MediaStream | null } | null => {
      if (typeof window === "undefined") return null;
      let ctx = ctxRef.current;
      if (!ctx) {
        try {
          ctx = new AudioContext();
        } catch {
          return null;
        }
        const master = ctx.createGain();
        master.gain.value = 1;
        let stream: MediaStream | null = null;
        if (!opts?.direct) {
          try {
            const dest = ctx.createMediaStreamDestination();
            master.connect(dest);
            stream = dest.stream;
          } catch {
            /* no stream destination: play straight out */
          }
        }

        const musicGain = ctx.createGain();
        musicGain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = MUSIC.filterHz;
        filter.Q.value = 0.7;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = MUSIC.filterLfoHz;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = MUSIC.filterSweepHz;
        lfo.connect(lfoGain).connect(filter.frequency);
        lfo.start();
        const delay = ctx.createDelay(2);
        delay.delayTime.value = MUSIC.delaySeconds;
        const feedback = ctx.createGain();
        feedback.gain.value = MUSIC.delayFeedback;
        delay.connect(feedback).connect(delay);
        filter.connect(musicGain);
        filter.connect(delay).connect(musicGain);
        musicGain.connect(master);

        const speech = ctx.createGain();
        speech.gain.value = 1;
        speech.connect(master);

        ctxRef.current = ctx;
        masterRef.current = master;
        musicGainRef.current = musicGain;
        musicInRef.current = filter;
        speechRef.current = speech;
        streamRef.current = stream;
        if (!stream) connectDirect();
      }
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      return { ctx, speech: speechRef.current as AudioNode, stream: streamRef.current };
    },
    [connectDirect],
  );

  const earcon = useCallback((kind: EarconKind) => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + 0.01;
    for (const n of EARCONS[kind]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = midiToHz(n.midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + n.at);
      g.gain.linearRampToValueAtTime(0.16, t0 + n.at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + n.at + n.dur);
      osc.connect(g).connect(master);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  }, []);

  const playChord = useCallback(() => {
    const ctx = ctxRef.current;
    const input = musicInRef.current;
    if (!ctx || !input) return;
    const now = ctx.currentTime;
    // Fade the previous chord out over its release, then free it.
    for (const v of chordVoicesRef.current) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + MUSIC.releaseSeconds);
      for (const o of v.oscs) o.stop(now + MUSIC.releaseSeconds + 0.1);
    }
    chordVoicesRef.current = [];
    const notes = chordAt(chordIndexRef.current++);
    for (const midi of notes) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.22 / notes.length, now + MUSIC.attackSeconds);
      gain.connect(input);
      const oscs = [ctx.createOscillator(), ctx.createOscillator()];
      oscs[0].type = "sine";
      oscs[1].type = "triangle";
      oscs[0].frequency.value = midiToHz(midi);
      oscs[1].frequency.value = midiToHz(midi);
      oscs[0].detune.value = -MUSIC.detuneCents;
      oscs[1].detune.value = MUSIC.detuneCents;
      for (const o of oscs) {
        o.connect(gain);
        o.start(now);
      }
      chordVoicesRef.current.push({ oscs, gain });
    }
  }, []);

  const startMusic = useCallback(() => {
    const ctx = ctxRef.current;
    const g = musicGainRef.current;
    if (!ctx || !g || musicTimerRef.current !== null) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(MUSIC.level, ctx.currentTime + 2);
    playChord();
    musicTimerRef.current = window.setInterval(playChord, MUSIC.chordSeconds * 1000);
  }, [playChord]);

  const stopMusic = useCallback(() => {
    const ctx = ctxRef.current;
    const g = musicGainRef.current;
    if (musicTimerRef.current !== null) window.clearInterval(musicTimerRef.current);
    musicTimerRef.current = null;
    if (!ctx || !g) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  }, []);

  /** Lower the bed under the voice, and bring it back slowly after. */
  const duck = useCallback((on: boolean) => {
    const ctx = ctxRef.current;
    const g = musicGainRef.current;
    if (!ctx || !g || musicTimerRef.current === null) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(
      on ? MUSIC.ducked : MUSIC.level,
      ctx.currentTime + (on ? 0.3 : 1.5),
    );
  }, []);

  const dispose = useCallback(() => {
    stopMusic();
    const ctx = ctxRef.current;
    ctxRef.current = null;
    masterRef.current = null;
    musicGainRef.current = null;
    musicInRef.current = null;
    speechRef.current = null;
    streamRef.current = null;
    chordVoicesRef.current = [];
    directRef.current = false;
    void ctx?.close().catch(() => {});
  }, [stopMusic]);

  useEffect(() => dispose, [dispose]);

  return { arm, connectDirect, earcon, startMusic, stopMusic, duck, dispose };
}
