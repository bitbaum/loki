import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".python-vendor/**",
    "packages/agent/**",
  ]),
  {
    // eslint-config-next ships eslint-plugin-react with `version: 'detect'`,
    // which calls context.getFilename — removed in ESLint 10 — and crashes the
    // whole lint run. Pinning the version skips detection. Placed after the
    // next configs so their 'detect' cannot win (order matters; a pin placed
    // before them was overridden in a sibling repo).
    settings: { react: { version: "19.2.8" } },
    rules: {
      // An unused import is a warning by default, which means it prints on
      // every commit and never blocks one. `os` sat unused in box-workspace.ts
      // long enough that every pre-commit hook run ended in "✖ 1 problem" —
      // and a lint output that always ends in a problem trains you to stop
      // reading it, which is how a real warning gets missed. Make it an error
      // so the count is zero and any future one is impossible to ignore.
      // `_`-prefixed names stay legal: that is the way to say "deliberately
      // unused" (a required positional arg, a destructured field you are
      // dropping) instead of deleting something you actually need.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Close the keystroke-hijack class (2026-07 dogfood): a global keyboard
      // shortcut's "is the user typing?" guard must inspect the COMPOSED path
      // leaf, not e.target. When a keystroke crosses a shadow-DOM boundary
      // (an embedded widget's input), e.target is retargeted to the shadow
      // host and the guard misreads a text field as "not typing", so the
      // shortcut fires and eats the keystroke. Pass e.composedPath()[0], never
      // a bare `.target`, into the typing guard.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='isTypingTarget'] > MemberExpression.arguments[property.name='target']",
          message:
            "Pass the composed-path leaf to isTypingTarget (e.composedPath()[0] ?? e.target), not a bare e.target — a bare .target is shadow-DOM-blind and reintroduces the keystroke-hijack bug.",
        },
        // Close the placeholder-answer class (2026-08 dogfood, second
        // occurrence): the profile extractor writes the literal "Unknown" for
        // fields it cannot infer, so `attrs.x?.trim()` reads as "the value, if
        // any" while actually returning a non-answer. That scored health
        // points, satisfied gates, and briefed agents with "STACK: Unknown".
        // hasAnswer(attrs.x) for the boolean, answer(attrs.x) for the value —
        // both from lib/project-display, so they can never disagree.
        ...["callee.object.object.name='attrs'", "callee.object.object.property.name='attrs'"].map(
          (attrsRef) => ({
            selector: `CallExpression[callee.property.name='trim'][${attrsRef}]`,
            message:
              "Don't trim a project attribute directly — use answer(attrs.x) for the value or hasAnswer(attrs.x) for the check (@/lib/project-display). A raw .trim() treats the extractor's literal \"Unknown\" as a filled field.",
          }),
        ),
        // Same class, one level up: the bulk GitHub import stamped projects with
        // the description "Local repository", which PLACEHOLDER_DESCRIPTIONS is
        // meant to swallow. Handing the raw field to a prop skips that — it was
        // printing under the project title on prod 2026-08-05, and shipping to
        // a PUBLIC OrangeCat profile from orangecat-publish.
        ...["object.name='project'", "object.property.name='project'"].map((projectRef) => ({
          selector: `JSXExpressionContainer > MemberExpression[property.name='description'][${projectRef}]`,
          message:
            'Pass cleanDescription(project.description), not the raw field — the import placeholder ("Local repository") is not a description and must never render or publish.',
        })),
      ],
    },
  },

  // ── Function length ────────────────────────────────────────────────────────
  //
  // A 733-line POST handler is not a style problem, it is the thing that makes
  // a file unreadable and unreviewable, and nothing was watching it grow. On
  // 2026-09-15 the repo held a 733-line orchestration POST, a 627-line
  // injectPrompt, a 492-line control GET, a 450-line chat POST and a 776-line
  // widget mount(); all five were split, and this rule is what keeps the next
  // one from arriving unannounced.
  //
  // It is an ERROR, not a warning, because a warning on a 200-file repo is a
  // number nobody reads. Comments and blank lines are skipped: this codebase
  // comments heavily on purpose (the WHY notes are load-bearing) and a rule
  // that punished that would push explanation out of the code.
  //
  // Two thresholds, because the two halves fail differently. Logic — routes,
  // lib, queries, the agent library — is where length hides branching, so it
  // gets the tight bound. A React component's length is mostly JSX depth,
  // which is real but far less dangerous, so it gets a looser one. Both are
  // set just above today's worst case: they are RATCHETS. Lower them when the
  // worst case drops; never raise one to let a new function in.
  {
    files: ["src/app/api/**/*.ts", "src/lib/**/*.ts", "src/db/**/*.ts", "home/**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  {
    files: ["src/components/**/*.tsx", "src/app/**/*.tsx", "src/hooks/**/*.ts", "widget/**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 510, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
]);

export default eslintConfig;
