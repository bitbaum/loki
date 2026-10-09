"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { NO_SCREEN_PAGE } from "@/config/no-screen";
import { useSoundscape } from "@/hooks/use-soundscape";
import { createSynthSpeaker } from "@/lib/voice/speaker";
import type { EarconKind } from "@/lib/voice/soundscape";

/**
 * "Hear it": twenty seconds of what the headphones get, on the public page,
 * using the visitor's own phone — the music bed the phone composes, an
 * earcon before each piece of news, the briefing read aloud. The phone's
 * voice reads it here (the studio voice is for signed-in use); the page
 * says so under the button, because a demo that sounds better than the
 * product is a lie and one that sounds worse is an apology.
 */
export function NoScreenDemo() {
  const sound = useSoundscape();
  const [playing, setPlaying] = useState(false);
  const tokenRef = useRef(0);
  const speakerRef = useRef(createSynthSpeaker());

  const stop = () => {
    tokenRef.current++;
    speakerRef.current.cancel();
    sound.stopMusic();
    setPlaying(false);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps -- unmount only

  const play = async () => {
    const armed = sound.arm({ direct: true });
    if (!armed) return;
    const my = ++tokenRef.current;
    setPlaying(true);
    sound.startMusic();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const line = async (text: string, earcon?: EarconKind) => {
      if (my !== tokenRef.current) return;
      if (earcon) sound.earcon(earcon);
      await wait(earcon ? 500 : 0);
      if (my !== tokenRef.current) return;
      sound.duck(true);
      await speakerRef.current.speak(text);
      sound.duck(false);
      await wait(900);
    };
    await wait(2500);
    for (const step of NO_SCREEN_PAGE.demo) await line(step.text, step.earcon);
    if (my === tokenRef.current) {
      await wait(3000);
      stop();
    }
  };

  return (
    <div className="ui-public-hear">
      <button
        type="button"
        className={playing ? "ui-public-cta-ghost" : "ui-public-cta"}
        onClick={playing ? stop : () => void play()}
        aria-pressed={playing}
      >
        {playing ? (
          <Pause className="mr-2 h-4 w-4" aria-hidden />
        ) : (
          <Play className="mr-2 h-4 w-4" aria-hidden />
        )}
        {playing ? "Stop" : NO_SCREEN_PAGE.demoCta}
      </button>
      <p className="ui-public-hear-note">{NO_SCREEN_PAGE.demoNote}</p>
    </div>
  );
}
