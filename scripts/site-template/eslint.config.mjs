import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // ESLint 10 removed the `context.getFilename()` that eslint-plugin-react's
    // version `detect` still calls. Pin the version so `detect` never runs;
    // keep it in step with `react` in package.json.
    settings: { react: { version: "19.3.0" } },
  },
  {
    rules: {
      // Links inside the site go through @/i18n/navigation, so a reader on
      // /de stays on /de. next/link drops the language prefix.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next/link", message: "Use Link from @/i18n/navigation." },
            {
              name: "next/navigation",
              importNames: ["redirect", "useRouter", "usePathname"],
              message: "Use the language-aware versions from @/i18n/navigation.",
            },
          ],
        },
      ],
      // Personal data must not reach logs. console.error/warn stay for
      // operational messages; console.log is how a request body ends up in
      // journald.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**"]),
]);

export default eslintConfig;
