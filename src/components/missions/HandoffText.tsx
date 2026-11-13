"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An agent's handoff note, three lines at most until asked. The notes are
 * written by agents for agents — commit hashes, branch names, paths, test
 * counts — and a full one pushed the rest of the mission off the phone
 * (2026-11-12). The words stay; the length is the reader's choice.
 */
export function HandoffText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180 || text.split("\n").length > 3;
  return (
    <>
      <span
        className={cn("block whitespace-pre-wrap wrap-anywhere", !open && long && "line-clamp-3")}
      >
        {text}
      </span>
      {long && (
        <button
          type="button"
          className="ui-link-muted inline-flex min-h-11 items-center"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </>
  );
}
