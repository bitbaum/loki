import {
  CONSULT,
  CONSULT_AREAS,
  CONSULT_CHECKS,
  CONSULT_SEVERITY,
  type ConsultArea,
  type ConsultCheckId,
  type ConsultSeverity,
} from "@/config/site-consult";
import type { PageTour } from "@/lib/site-consult/crawl";
import type { PageFacts } from "@/lib/site-consult/read-page";

/**
 * The consultation's judgement: page facts in, findings out. Rules only — each
 * one either finds the thing in what the page served or does not, and a rule
 * that cannot be judged from the page (no images, no copyright line) is
 * skipped rather than counted either way. Copy lives in config/site-consult.
 *
 * Pure: pinned in scripts/test/site-consult.ts.
 */

export type Finding = {
  id: ConsultCheckId;
  area: ConsultArea;
  severity: ConsultSeverity;
  title: string;
  why: string;
  /** What Loki saw on THIS page — the proof behind the claim. */
  evidence: string | null;
};

export type Consultation = {
  site: { url: string; host: string; title: string | null; description: string | null };
  headline: string;
  findings: Finding[];
  passed: { id: ConsultCheckId; label: string }[];
  counts: { urgent: number; improve: number; passed: number };
  /** Every page Loki read, homepage first — the tour a person sees. */
  pages: PageTour[];
};

type Verdict =
  | { id: ConsultCheckId; ok: true }
  | { id: ConsultCheckId; ok: false; evidence?: string; severity?: ConsultSeverity };

export type ServedPage = {
  finalUrl: string;
  ms: number;
  bytes: number;
  facts: PageFacts;
};

const GENERIC_TITLE =
  /^(home|homepage|startseite|start|accueil|inicio|index|untitled|welcome|willkommen|bienvenue|benvenuti|default|my site|my website|website|page|new page|document)$/i;

const quote = (text: string, max = 70) =>
  `“${text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text}”`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;

function judge({ finalUrl, ms, bytes, facts: f }: ServedPage, year: number): Verdict[] {
  const v: Verdict[] = [];
  const add = (id: ConsultCheckId, ok: boolean, evidence?: string, severity?: ConsultSeverity) =>
    v.push(ok ? { id, ok } : { id, ok, evidence, severity });

  const https = finalUrl.startsWith("https:");
  add("not-https", https, "The page opens on http://, without encryption.");
  if (https)
    add(
      "mixed-content",
      f.insecureResources === 0,
      `${f.insecureResources} ${f.insecureResources === 1 ? "item loads" : "items load"} over plain http://.`,
    );
  if (f.copyrightYear !== null)
    add("stale-copyright", f.copyrightYear >= year - 1, `The footer says © ${f.copyrightYear}.`);

  add("no-viewport", Boolean(f.viewport), "The page has no mobile viewport setting.");
  if (f.viewport) {
    const blocked = /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.exec(f.viewport);
    add("zoom-blocked", !blocked, blocked ? `The page says ${quote(blocked[0])}.` : undefined);
  }

  const noindex = /\b(noindex|none)\b/.test(f.robots);
  add("noindex", !noindex, "The page carries a “noindex” instruction.");
  add("no-title", Boolean(f.title));
  if (f.title) {
    const t = f.title;
    const problem = GENERIC_TITLE.test(t)
      ? `It reads ${quote(t)} — that could be any website.`
      : t.length < CONSULT.titleMin
        ? `It reads ${quote(t)} — too short to say what you offer.`
        : t.length > CONSULT.titleMax
          ? `It is ${t.length} characters; Google cuts it off at about 60.`
          : null;
    add("weak-title", !problem, problem ?? undefined);
  }
  add("no-description", Boolean(f.description));
  add("no-h1", f.h1Count > 0);
  add(
    "thin-text",
    f.words >= CONSULT.thinTextWords,
    `The whole page holds ${f.words} ${f.words === 1 ? "word" : "words"}.`,
  );
  add("no-structured-data", f.hasStructuredData);

  add("no-share-preview", f.hasShareImage, "No share image is set (og:image).");
  add("no-contact", f.telLinks + f.mailLinks + f.forms + f.contactLinks > 0);
  if (f.plainPhone) add("phone-not-tappable", false, `${quote(f.plainPhone, 30)} is plain text.`);
  else if (f.telLinks) add("phone-not-tappable", true);

  add(
    "slow",
    ms < CONSULT.slowMs,
    `It took ${seconds(ms)} to arrive at Loki’s server, before a single image.`,
    ms >= CONSULT.verySlowMs ? "urgent" : undefined,
  );
  add(
    "heavy-page",
    bytes < CONSULT.heavyHtmlBytes,
    `The page’s code alone is ${Math.round(bytes / 1024)} KB.`,
  );
  if (f.images > 0)
    add(
      "images-no-alt",
      f.imagesWithoutAlt / f.images <= CONSULT.altMissingShare,
      `${f.imagesWithoutAlt} of ${f.images} images have no description.`,
    );
  add("no-lang", Boolean(f.lang));
  return v;
}

/**
 * What only shows across pages: links that lead nowhere, one title on many
 * pages, pages that say almost nothing. Judged only when the tour read at
 * least one page beyond the homepage — one page cannot fail a site rule.
 */
export function siteVerdicts(home: PageTour, tour: PageTour[]): Verdict[] {
  if (tour.length === 0) return [];
  const v: Verdict[] = [];
  const list = (paths: string[]) =>
    paths.length > 3
      ? `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more`
      : paths.join(", ");

  const broken = tour.filter((p) => !p.ok);
  v.push(
    broken.length
      ? {
          id: "broken-pages",
          ok: false,
          evidence: `${list(broken.map((p) => p.path))} did not open.`,
        }
      : { id: "broken-pages", ok: true },
  );

  const read = [home, ...tour].filter((p) => p.ok);
  const byTitle = new Map<string, string[]>();
  for (const p of read) {
    const key = p.title?.trim().toLowerCase();
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), p.path]);
  }
  const shared = [...byTitle.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (read.length > 1)
    v.push(
      shared && shared[1].length > 1
        ? {
            id: "duplicate-titles",
            ok: false,
            evidence: `${shared[1].length} pages (${list(shared[1])}) are all titled ${quote(read.find((p) => p.title?.trim().toLowerCase() === shared[0])?.title ?? shared[0])}.`,
          }
        : { id: "duplicate-titles", ok: true },
    );

  const thin = tour.filter((p) => p.ok && p.words < CONSULT.thinPageWords);
  if (tour.some((p) => p.ok))
    v.push(
      thin.length
        ? {
            id: "thin-pages",
            ok: false,
            evidence: `${list(thin.map((p) => `${p.path} (${p.words} words)`))}.`,
          }
        : { id: "thin-pages", ok: true },
    );
  return v;
}

const AREA_ORDER = Object.keys(CONSULT_AREAS) as ConsultArea[];

function headline(urgent: number, improve: number, pages: number): string {
  const where = pages > 1 ? "on your site" : "on this page";
  if (urgent === 1) return `One thing ${where} is likely costing you visitors right now.`;
  if (urgent > 1) return `${urgent} things ${where} are likely costing you visitors right now.`;
  if (improve === 1) return "No emergencies — one thing is worth improving.";
  if (improve > 1) return `No emergencies — ${improve} things are worth improving.`;
  return "The basics are in good shape. A new version is about what you want next.";
}

export function consult(
  page: ServedPage,
  year = new Date().getFullYear(),
  tour: PageTour[] = [],
): Consultation {
  const url0 = new URL(page.finalUrl);
  const home: PageTour = {
    path: url0.pathname.replace(/\/+$/, "") || "/",
    url: page.finalUrl,
    ok: true,
    title: page.facts.title,
    hasDescription: Boolean(page.facts.description),
    h1Count: page.facts.h1Count,
    words: page.facts.words,
    ms: page.ms,
    problem: null,
  };
  const verdicts = [...judge(page, year), ...siteVerdicts(home, tour)];
  const failing = verdicts.filter((x): x is Extract<Verdict, { ok: false }> => !x.ok);
  const findings: Finding[] = failing
    .map((x) => {
      const check = CONSULT_CHECKS[x.id];
      return {
        id: x.id,
        area: check.area,
        severity: x.severity ?? check.severity,
        title: check.title,
        why: check.why,
        evidence: x.evidence ?? null,
      };
    })
    .sort(
      (a, b) =>
        CONSULT_SEVERITY[a.severity].order - CONSULT_SEVERITY[b.severity].order ||
        AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area),
    );
  const passed = verdicts
    .filter((x) => x.ok)
    .map((x) => ({ id: x.id, label: CONSULT_CHECKS[x.id].passed }));
  const urgent = findings.filter((x) => x.severity === "urgent").length;
  const url = new URL(page.finalUrl);
  return {
    site: {
      url: page.finalUrl,
      host: url.hostname.replace(/^www\./, ""),
      title: page.facts.title,
      description: page.facts.description,
    },
    headline: headline(urgent, findings.length - urgent, 1 + tour.length),
    findings,
    passed,
    counts: { urgent, improve: findings.length - urgent, passed: passed.length },
    pages: [home, ...tour],
  };
}
