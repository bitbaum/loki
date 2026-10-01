import { permanentRedirect } from "next/navigation";

/**
 * /frontier is retired.
 *
 * It promised an AI & robotics digest "distilled daily", but the job that
 * wrote it was removed on 2026-09-25 (#897: no background job may spend the
 * free AI tier). The page froze on that day, unranked, showing raw arXiv
 * abstracts and one leaked HTML fragment — while the nav and every footer
 * still advertised it as daily. Thoughts is where Loki's writing lives.
 */
export default function FrontierPage(): never {
  permanentRedirect("/thoughts");
}
