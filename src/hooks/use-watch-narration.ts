"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api/fetch";
import {
  NARRATE_MAX_LINES,
  pushNarration,
  shouldNarrate,
  type Narration,
} from "@/lib/watch-narration";

export type StoryBeat = { narration: Narration; at: number };

/**
 * Loki's running narration of a live build, from the screen Watch already
 * peeks. Asks only when the screen has moved and the last answer is at least
 * half a minute old (lib/watch-narration → shouldNarrate); a failed or empty
 * answer keeps the story as it was.
 */
export function useWatchNarration(projectId: string, screen: string[] | null, live: boolean) {
  const [story, setStory] = useState<StoryBeat[]>([]);
  const last = useRef<{ key: string | null; at: number | null; inFlight: boolean }>({
    key: null,
    at: null,
    inFlight: false,
  });

  // Unmount only. A new screen arrives every few seconds; cancelling the
  // answer in flight each time would mean no narration ever landed.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const screenKey = screen ? screen.slice(-NARRATE_MAX_LINES).join("\n") : "";
  const previous = story.at(-1)?.narration.headline ?? null;

  useEffect(() => {
    if (!live || !screen) return;
    const now = Date.now();
    if (
      !shouldNarrate({
        screenKey,
        lastKey: last.current.key,
        lastAt: last.current.at,
        now,
        inFlight: last.current.inFlight,
      })
    )
      return;
    last.current = { key: screenKey, at: now, inFlight: true };
    postJson(`/api/projects/${projectId}/watch/narrate`, {
      screen: screen.slice(-NARRATE_MAX_LINES),
      previous,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { narration?: Narration | null } | null) => {
        if (!mounted.current || !body?.narration) return;
        const beat: StoryBeat = { narration: body.narration, at: Date.now() };
        setStory((s) => pushNarration(s, beat));
      })
      .catch(() => undefined)
      .finally(() => {
        last.current = { ...last.current, inFlight: false };
      });
    // `screen` is read through screenKey; `previous` rides along with the ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey, live, projectId]);

  return story;
}
