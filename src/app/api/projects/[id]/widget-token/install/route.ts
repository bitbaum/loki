import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getProjectCore } from "@/db/queries/projects";
import { getActiveWidgetToken, upsertWidgetToken } from "@/db/queries/widget-tokens";
import { injectPrompt } from "@/lib/inject-core";
import { injectWatchUrls } from "@/lib/fleet-context";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { appUrl } from "@/lib/email";
import { resolveProjectPublicOrigin, resolveProjectRepoTarget } from "@/lib/feedback/project-site";

/**
 * One-click widget install/uninstall. Auto-enables the token when missing.
 * Uses Hetzner liveUrl (user_projects) as the site of truth — never a stale
 * legacy host. Refuses when there is no repo/dir for the agent to change.
 */

const InstallBody = z.object({
  mode: z.enum(["install", "uninstall"]).default("install"),
  /** When true, queue the agent even if the live site probe failed (repo-only). */
  force: z.boolean().optional(),
});

function snippetFor(token: string): string {
  const base = appUrl().replace(/\/$/, "");
  return `<script src="${base}/widget.js" data-fc-project="${token}" async></script>`;
}

function composeInstallPrompt(
  projectName: string,
  token: string,
  liveOrigin: string | null,
  siteNote: string | null,
): string {
  return [
    `Install the Loki feedback widget on ${projectName}'s public site.`,
    liveOrigin ? `\nLIVE SITE (Hetzner): ${liveOrigin}\n` : "",
    siteNote ? `\nSITE STATUS: ${siteNote}\n` : "",
    "THE SNIPPET (use exactly this — do not alter the token or attributes):",
    "```html",
    snippetFor(token),
    "```",
    "",
    "1. If this exact snippet (or an embed referencing the same widget.js + data-fc-project token) is already present anywhere in the codebase, do NOT add a second one — verify it renders and report that in your handoff.",
    "2. Otherwise add it once, in the site's root layout/template so it loads on every public page:",
    '   - Next.js App Router: next/script with strategy="afterInteractive" and the SAME data-fc-project token. Bake the token as a string literal (or ensure LOKI_FEEDBACK_TOKEN is present at `next build`). Runtime-only .env after deploy is NOT enough — Next tree-shakes an empty token and the Script never ships.',
    "   - Plain HTML / other frameworks: the raw tag right before </body> in the base template.",
    "3. If the site already has its own floating button (an Ask or chat button) in a corner, change nothing: the launcher takes the other corner by itself, or a slim edge tab when both are taken. Do not add data-fc-bottom — it stacks the two into one tower.",
    "4. Verify: run the site locally and confirm the page loads without console errors from the embed. (The FAB itself may stay hidden — rendering is server-gated per token — absence of the button is NOT a failure; absence of errors is the check.) If the host has a Content-Security-Policy, add https://loki.orangecat.ch to script-src AND connect-src — otherwise the browser blocks widget.js even when the tag is in the HTML.",
    "5. Ship it the way this repo ships changes (branch + PR if that's the convention). Deploy is on Hetzner — push/merge so the box picks it up. Smallest possible diff — the embed and nothing else.",
    "6. HANDOFF: state the exact file(s) touched and the verification evidence. If you could not push or the live URL is down, say so plainly — do not claim the widget is live.",
  ]
    .filter(Boolean)
    .join("\n");
}

function composeUninstallPrompt(projectName: string, token: string | null): string {
  const marker = token ? `data-fc-project="${token}"` : "data-fc-project";
  return [
    `Remove the Loki feedback widget embed from ${projectName}'s codebase.`,
    "",
    `1. Find every trace of the embed: search for "widget.js" together with ${marker}, and for any component that injects that script tag (a name like LokiFeedbackEmbed is typical).`,
    "2. Remove the snippet/component and its mount point (e.g. the import + JSX usage in the layout). Delete the embed component file if it exists solely for this.",
    "3. Do NOT touch anything else — no unrelated cleanup.",
    "4. Verify: the site builds and runs locally with no dangling imports and no reference to the widget left (grep proves it).",
    "5. Ship it the way this repo ships changes (branch + PR if that's the convention).",
    "6. HANDOFF: state the file(s) touched and the grep evidence that zero references remain. If no embed exists in the codebase, change nothing and report that.",
  ].join("\n");
}

type SiteProbe = {
  ok: boolean;
  status: number | null;
  message: string;
};

async function probeSite(origin: string | null): Promise<SiteProbe | null> {
  if (!origin) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(origin, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { Accept: "text/html" },
    });
    clearTimeout(timer);
    if (res.status === 402) {
      return {
        ok: false,
        status: 402,
        message:
          "Live site returned HTTP 402 (deployment disabled or unpaid host). The widget cannot appear until the site is reachable again.",
      };
    }
    if (res.status >= 500) {
      return {
        ok: false,
        status: res.status,
        message: `Live site returned HTTP ${res.status}. Fix hosting before expecting the widget to show.`,
      };
    }
    if (!res.ok && res.status !== 401 && res.status !== 403) {
      return {
        ok: false,
        status: res.status,
        message: `Live site returned HTTP ${res.status}.`,
      };
    }
    return { ok: true, status: res.status, message: "Live site responded." };
  } catch {
    return {
      ok: false,
      status: null,
      message: "Live site did not respond. Widget cannot be verified there until it is reachable.",
    };
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, InstallBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return jsonError("Project not found", 404);

  const watch = injectWatchUrls(project.name);
  const repo = await resolveProjectRepoTarget(userId, idOrResp);
  const gitUrl = project.gitUrl || repo.gitUrl;
  const dirPath = repo.dirPath;

  // Agent needs a repo clone URL and/or a local dir on the runner.
  if (dataOrResp.mode === "install" && !gitUrl && !dirPath) {
    return NextResponse.json(
      {
        error:
          "No git URL and no local project directory — “Put it on the site” cannot land the snippet. Add the GitHub URL on the project, or paste the widget snippet manually from the project Widget card.",
        ...watch,
        code: "no_repo",
      },
      { status: 422 },
    );
  }

  const liveOrigin = await resolveProjectPublicOrigin(userId, idOrResp);

  let token = await getActiveWidgetToken(userId, idOrResp);

  // Probe BEFORE minting or mutating anything: a failed install must not leave
  // a fresh active token (or a rewritten allowlist) behind as a side effect.
  const siteProbe = dataOrResp.mode === "install" ? await probeSite(liveOrigin) : null;

  if (dataOrResp.mode === "install" && siteProbe && !siteProbe.ok && !dataOrResp.force) {
    return NextResponse.json(
      {
        error: siteProbe.message,
        siteProbe,
        ...watch,
        code: "site_unreachable",
        tokenReady: !!token,
        hint: "Fix the live site on the box, then tap “Put it on the site” again. Or open the project Widget card and copy the snippet by hand.",
      },
      { status: 422 },
    );
  }

  if (dataOrResp.mode === "install" && !token) {
    token = await upsertWidgetToken(userId, idOrResp, {
      origins: liveOrigin ? [liveOrigin] : undefined,
    });
  } else if (
    dataOrResp.mode === "install" &&
    token &&
    liveOrigin &&
    token.origins?.length &&
    !token.origins.includes(liveOrigin)
  ) {
    // MERGE the live origin into the allowlist — never replace it. The old
    // "all origins look like vercel.app → overwrite" heuristic silently broke
    // ingest for widgets legitimately still served from a matched host: the
    // running embed's POSTs started failing the allowlist (the documented
    // security boundary) and visitor feedback dropped on the floor. A union
    // can only widen where the widget may live, never break where it does.
    token = await upsertWidgetToken(userId, idOrResp, {
      origins: [...token.origins, liveOrigin],
    });
  }

  const siteNote = siteProbe && !siteProbe.ok ? siteProbe.message : null;
  const prompt =
    dataOrResp.mode === "install"
      ? token
        ? composeInstallPrompt(project.name, token.token, liveOrigin, siteNote)
        : null
      : composeUninstallPrompt(project.name, token?.token ?? null);
  if (!prompt) {
    return jsonError("Could not enable the widget token for this project", 400);
  }

  const { status, body } = await injectPrompt(
    { tab: project.name, customPrompt: prompt, notifyOnClose: true },
    userId,
  );
  return NextResponse.json(
    {
      ...body,
      tokenCreated: dataOrResp.mode === "install" && !!token,
      siteProbe,
      liveOrigin,
      ...watch,
      nextStep:
        status < 400
          ? `Queued for this project. Watch Control and Activity. Terminal only shows a session once the agent is actually running. ${EXECUTOR_COPY.honesty.notificationWhenDone}`
          : undefined,
    },
    { status },
  );
}
