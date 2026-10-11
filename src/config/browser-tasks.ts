/**
 * Browser hand-offs — forms Loki fills in the operator's own browser and
 * hands back one click short of done.
 *
 * Some steps belong to a person on purpose: npm's trusted-publisher form ends
 * in a passkey only the operator holds, and that is the point of it. What does
 * NOT belong to them is everything before it — finding the page, typing four
 * fields exactly right, knowing which unlabelled checkbox the release needs.
 * On 2026-10-11 that took three rounds of chat and a phone screenshot, and the
 * form still hid two traps (a capitalised org that cannot be edited later, and
 * "Allow npm publish" off by default). Loki now does that part: Fleet Runner
 * opens the page in its own browser window, fills it, outlines the final
 * button, and stops. The operator presses it.
 *
 * Recipes, not free-form steps: a cloud row can only ask the runner for a form
 * named here, with parameters that pass `build`. Nothing reaching the queue can
 * make the runner type into an arbitrary page — the same reason inject payloads
 * are validated before they reach a shell.
 *
 * The runner NEVER presses `handoff.button`. There is no step kind that submits.
 */

export type BrowserStep =
  /** Press a tab or button that reveals the form — only while `unless` (a field
   *  label) is not on the page yet, so a second run never toggles it back. */
  | { kind: "click"; text: string; unless: string }
  | { kind: "fill"; label: string; value: string }
  | { kind: "check"; label: string; checked: boolean };

export type BrowserTask = {
  /** Shown on the window and in Loki: what this form does, in a few words. */
  title: string;
  url: string;
  /** The runner only fills on this host; anywhere else (a sign-in page on
   *  another domain) it waits and says so. */
  host: string;
  steps: BrowserStep[];
  handoff: {
    /** The visible text of the button the operator presses. Never clicked. */
    button: string;
    /** One sentence for the banner once the form is filled. */
    say: string;
  };
};

type Recipe<P extends string> = {
  title: string;
  params: readonly P[];
  /** null when a parameter is malformed — the row is refused, never guessed. */
  build: (params: Record<P, string>) => BrowserTask | null;
};

const NPM_PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const WORKFLOW_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;

const npmTrustedPublisher: Recipe<"package" | "owner" | "repo" | "workflow"> = {
  title: "npm trusted publisher",
  params: ["package", "owner", "repo", "workflow"],
  build: ({ package: pkg, owner, repo, workflow }) => {
    if (!NPM_PACKAGE.test(pkg) || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) return null;
    if (!WORKFLOW_FILE.test(workflow)) return null;
    return {
      title: `Let ${owner}/${repo} publish ${pkg}`,
      url: `https://www.npmjs.com/package/${pkg}/access`,
      host: "www.npmjs.com",
      steps: [
        { kind: "click", text: "GitHub Actions", unless: "Repository" },
        // GitHub names are case-insensitive but npm matches the OIDC claim
        // as written, and the connection cannot be edited once created. The
        // form's own autofill offered "Bitbaum"; the org is "bitbaum".
        { kind: "fill", label: "Organization or user", value: owner },
        { kind: "fill", label: "Repository", value: repo },
        { kind: "fill", label: "Workflow filename", value: workflow },
        // Off by default, and without it the connection may only STAGE a
        // publish: `npm publish` in the workflow would fail with a 404 again.
        { kind: "check", label: "Allow npm publish", checked: true },
      ],
      handoff: {
        button: "Set up connection",
        say: `Loki filled this in. Check it, then press "Set up connection" and confirm with your passkey.`,
      },
    };
  },
};

export const BROWSER_RECIPES = {
  "npm-trusted-publisher": npmTrustedPublisher,
} as const;

export type BrowserRecipeId = keyof typeof BROWSER_RECIPES;

export const BROWSER_RECIPE_IDS = Object.keys(BROWSER_RECIPES) as BrowserRecipeId[];

/** What travels in a `browser_task` pending command. */
export type BrowserTaskPayload = {
  recipe: BrowserRecipeId;
  params: Record<string, string>;
  /** Always the operator's own machine: the cloud builder has no one at it. */
  channel: "local";
};

/** The one gate both sides use: the API before it queues a row, and Fleet
 *  Runner before it opens a window. */
export function resolveBrowserTask(recipe: unknown, params: unknown): BrowserTask | null {
  if (typeof recipe !== "string" || !(recipe in BROWSER_RECIPES)) return null;
  if (!params || typeof params !== "object") return null;
  const def = BROWSER_RECIPES[recipe as BrowserRecipeId] as Recipe<string>;
  const values: Record<string, string> = {};
  for (const name of def.params) {
    const v = (params as Record<string, unknown>)[name];
    if (typeof v !== "string" || !v.trim()) return null;
    values[name] = v.trim();
  }
  return def.build(values);
}
