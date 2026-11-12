"use client";

import { useFetch } from "@/hooks/use-fetch";
import { useLocalNow } from "@/hooks/use-local-now";
import { List } from "@/components/ui/list-row";
import { NowJobRow } from "@/components/control/ControlNow";
import { buildNowJobs } from "@/components/control/control-now";
import { buildProjectOperationsSnapshots } from "@/components/control/control-presenter";
import type { ControlData } from "@/lib/control-types";

/**
 * What is being built or waiting for you, above the chat's greeting — the
 * same rows Home's "Being built" shows, each opening the live session where
 * it can be watched. The phone opens on /loki, and that screen said nothing
 * while two agents were waiting for the owner's answer (owner audit,
 * 2026-11-12: "I would like to know if anything is actively running, and I
 * would like to watch it"). Nothing at all when nothing runs.
 */
export function StartNow() {
  // Read once, each time the start screen opens (and on pull-to-refresh): the
  // snapshot is ~400 KB, too much to poll from a phone's chat. Home has the
  // live stream; this only has to say what runs and lead there.
  const { data } = useFetch<ControlData>("/api/control");
  const now = useLocalNow();
  // A reply of any other shape (an error body, a signed-out answer) is "no
  // news", never a broken start screen.
  if (!data || !Array.isArray(data.projects) || !now) return null;
  const nowMs = now.getTime();
  const snapshots = buildProjectOperationsSnapshots(
    data.projects,
    Array.isArray(data.liveTabs) ? data.liveTabs : [],
    Math.floor(nowMs / 1000),
  );
  // Waiting for you first: that is the one a person has to act on.
  const jobs = buildNowJobs(snapshots, nowMs)
    .filter((j) => j.tone !== "quiet")
    .sort((a, b) => (a.tone === "you" ? 0 : 1) - (b.tone === "you" ? 0 : 1));
  if (jobs.length === 0) return null;
  return (
    <List aria-label="Working now">
      {jobs.map((job) => (
        <NowJobRow key={job.tab} job={job} nowMs={nowMs} />
      ))}
    </List>
  );
}
