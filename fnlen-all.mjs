import { ESLint } from "eslint";
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser: (await import("@typescript-eslint/parser")).default,
        parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
      },
      rules: {
        "max-lines-per-function": [
          "warn",
          { max: 1, skipBlankLines: true, skipComments: true, IIFEs: true },
        ],
      },
    },
  ],
});
const results = await eslint.lintFiles(process.argv.slice(2));
const rows = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId !== "max-lines-per-function") continue;
    const n = Number(/has too many lines \((\d+)\)/.exec(m.message)?.[1] ?? 0);
    rows.push({ f: r.filePath.replace(process.cwd() + "/", ""), l: m.line, n });
  }
}
rows.sort((a, b) => b.n - a.n);
for (const r of rows.slice(0, 30)) console.log(String(r.n).padStart(5), `${r.f}:${r.l}`);
console.log("---");
for (const t of [100, 120, 150, 200, 250, 300, 400])
  console.log(`over ${t}: ${rows.filter((r) => r.n > t).length}`);
