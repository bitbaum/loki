/**
 * A React form built the way npm's trusted-publisher form is: a publisher
 * button that reveals the fields, labels that are not <label for>, help text
 * between a label and its input, an autofilled "Bitbaum", a checkbox inside its
 * label, and a final button that records whether anything pressed it.
 * Shared by scripts/test/browser-fill.ts and scripts/test/browser-extension.ts.
 */
import { build } from "esbuild";

const APP = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

function Field({ label, help, value, onChange }) {
  return (
    <div className="field">
      <label>{label}<span>*</span></label>
      {help ? <p>{help}</p> : null}
      <div><input value={value} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}

function App() {
  const [shown, setShown] = useState(false);
  const [owner, setOwner] = useState("Bitbaum");
  const [repo, setRepo] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [allow, setAllow] = useState(false);
  window.__state = { owner, repo, workflow, allow, tabPresses: window.__tabPresses || 0 };
  return (
    <main>
      <h2>Trusted Publisher</h2>
      <button onClick={() => { window.__tabPresses = (window.__tabPresses || 0) + 1; setShown(true); }}>GitHub Actions</button>
      {shown ? (
        <form onSubmit={(e) => e.preventDefault()}>
          <Field label="Organization or user" value={owner} onChange={setOwner} />
          <Field label="Repository" value={repo} onChange={setRepo} />
          <Field label="Workflow filename" help="Filename only (e.g., publish.yml)." value={workflow} onChange={setWorkflow} />
          <Field label="Environment name" value="" onChange={() => {}} />
          <label><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Allow <code>npm publish</code></label>
          <label><input type="checkbox" defaultChecked={false} /> Allow <code>npm dist-tag</code></label>
          <button type="button" onClick={() => { window.__submitted = true; }}>Set up connection</button>
        </form>
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
`;

export async function appBundle(): Promise<string> {
  const out = await build({
    stdin: { contents: APP, loader: "jsx", resolveDir: process.cwd() },
    bundle: true,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}
