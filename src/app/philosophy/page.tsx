import { permanentRedirect } from "next/navigation";

/** Merged into /why with /mission (2026-10-01): one page, one set of claims. */
export default function PhilosophyPage(): never {
  permanentRedirect("/why");
}
