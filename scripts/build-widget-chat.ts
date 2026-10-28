/**
 * Builds the widget's chat chunk — widget/chat/entry.tsx → public/widget-chat.js
 * (gitignored, like public/widget.js).
 *
 * The chunk is the shared chat (chatkit) for the widget, loaded only when the
 * panel opens (widget/chat-loader.ts). chatkit is written for React; here
 * Preact stands in for it through preact/compat, which keeps the chunk a
 * fraction of React's size on someone else's site. chatkit's stylesheet is
 * inlined as a string, corrected for a Shadow DOM (widget/chat/shadow-css.ts).
 *
 * Run: npx tsx scripts/build-widget-chat.ts
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform, type Plugin } from "esbuild";
import { shadowChatkitCss } from "../widget/chat/shadow-css";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

/** `import css from "@bitbaum/chatkit/styles/chat.css"` → compact, corrected CSS. */
const chatkitCss: Plugin = {
  name: "chatkit-css",
  setup(b) {
    b.onResolve({ filter: /^@bitbaum\/chatkit\/styles\/chat\.css$/ }, () => ({
      path: require.resolve("@bitbaum/chatkit/styles/chat.css"),
      namespace: "chatkit-css",
    }));
    b.onLoad({ filter: /.*/, namespace: "chatkit-css" }, async (args) => {
      // JS minification leaves text-loader contents untouched. Minify the
      // stylesheet itself before inlining it so new media controls fit the
      // existing widget download budget without removing shared styles.
      const css = await transform(shadowChatkitCss(readFileSync(args.path, "utf8")), {
        loader: "css",
        minify: true,
      });
      return { contents: css.code, loader: "text" };
    });
  },
};

export async function buildWidgetChat(opts: { write?: boolean; outfile?: string } = {}) {
  return build({
    entryPoints: [join(root, "widget/chat/entry.tsx")],
    outfile: opts.outfile ?? join(root, "public/widget-chat.js"),
    write: opts.write ?? true,
    bundle: true,
    minify: true,
    format: "iife",
    jsx: "automatic",
    jsxImportSource: "preact",
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [chatkitCss],
    logLevel: "warning",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildWidgetChat().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
